#!/usr/bin/env python3
"""Exclusive-mode controller for the RTX 3060 attached to Urithiru.

This program runs as root on the Proxmox host.  Its public surface is a small
allowlist of modes; callers never get arbitrary pct or systemctl access.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from typing import Any
import urllib.error
import urllib.request

try:
    import fcntl
except ImportError:  # Allows contract tests to import the module on Windows.
    fcntl = None  # type: ignore[assignment]


CONFIG_PATH = Path("/etc/optimus-gpu-controller.json")
LOCK_PATH = Path("/run/lock/optimus-gpu-controller.lock")
STATE_PATH = Path("/var/lib/optimus-gpu-controller/state.json")

SERVICES = {
    "llm": {"ct": "102", "unit": "bonsai.service"},
    "image": {"ct": "120", "unit": "comfyui.service"},
    "voice": {"ct": "120", "unit": "voicebox.service"},
}
MODES = ("voice", "image", "llm", "idle")

DEFAULT_CONFIG = {
    "voicebox_url": "http://192.168.0.120:17493",
    "voicebox_profile_id": "081fdf0f-c4ef-4b19-900c-5fa6d189661f",
    "voicebox_engine": "chatterbox_turbo",
    "comfyui_url": "http://192.168.0.120:8188/system_stats",
    "bonsai_url": "http://192.168.0.102:18080/health",
    "bonsai_completion_url": "http://192.168.0.102:18080/v1/chat/completions",
    "release_timeout_seconds": 60,
    "readiness_timeout_seconds": 150,
    "released_vram_ceiling_mb": 768,
}


class ControllerError(RuntimeError):
    pass


def run(args: list[str], *, timeout: int = 30, check: bool = True) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(
        args,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    if check and proc.returncode != 0:
        detail = (proc.stderr or proc.stdout).strip()
        raise ControllerError(f"{' '.join(args)} failed ({proc.returncode}): {detail}")
    return proc


def pct(service: str, *args: str, timeout: int = 30, check: bool = True) -> subprocess.CompletedProcess[str]:
    spec = SERVICES[service]
    return run(["pct", "exec", spec["ct"], "--", *args], timeout=timeout, check=check)


def load_config() -> dict[str, Any]:
    config = dict(DEFAULT_CONFIG)
    if CONFIG_PATH.exists():
        with CONFIG_PATH.open("r", encoding="utf-8") as handle:
            config.update(json.load(handle))
    return config


def service_snapshot() -> dict[str, dict[str, bool]]:
    result: dict[str, dict[str, bool]] = {}
    for name in SERVICES:
        active = pct(name, "systemctl", "is-active", "--quiet", SERVICES[name]["unit"], check=False)
        enabled = pct(name, "systemctl", "is-enabled", "--quiet", SERVICES[name]["unit"], check=False)
        result[name] = {"active": active.returncode == 0, "enabled": enabled.returncode == 0}
    return result


def detect_mode(services: dict[str, dict[str, bool]]) -> str:
    active = [name for name, state in services.items() if state["active"]]
    if not active:
        return "idle"
    if len(active) == 1:
        return active[0]
    return "mixed"


def gpu_snapshot() -> dict[str, int | None]:
    proc = run(
        [
            "nvidia-smi",
            "--query-gpu=memory.used,memory.total,utilization.gpu",
            "--format=csv,noheader,nounits",
        ],
        check=False,
    )
    if proc.returncode != 0:
        return {"memory_used_mb": None, "memory_total_mb": None, "utilization_percent": None}
    try:
        used, total, utilization = [int(value.strip()) for value in proc.stdout.splitlines()[0].split(",")]
    except (IndexError, ValueError):
        return {"memory_used_mb": None, "memory_total_mb": None, "utilization_percent": None}
    return {
        "memory_used_mb": used,
        "memory_total_mb": total,
        "utilization_percent": utilization,
    }


def read_state() -> dict[str, Any]:
    try:
        with STATE_PATH.open("r", encoding="utf-8") as handle:
            return json.load(handle)
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def write_state(mode: str) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {"desired_mode": mode, "updated_at": int(time.time())}
    fd, temp_name = tempfile.mkstemp(prefix="state-", suffix=".json", dir=STATE_PATH.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)
            handle.write("\n")
        os.replace(temp_name, STATE_PATH)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def status_payload() -> dict[str, Any]:
    services = service_snapshot()
    persisted = read_state()
    return {
        "ok": True,
        "mode": detect_mode(services),
        "desired_mode": persisted.get("desired_mode"),
        "services": services,
        "gpu": gpu_snapshot(),
    }


def set_service(name: str, enabled: bool) -> None:
    verb = "enable" if enabled else "disable"
    pct(name, "systemctl", verb, "--now", SERVICES[name]["unit"], timeout=90)


def stop_everything() -> None:
    errors = []
    for name in SERVICES:
        try:
            set_service(name, False)
        except Exception as exc:  # continue stopping peers before reporting
            errors.append(str(exc))
    if errors:
        raise ControllerError("; ".join(errors))


def wait_for_vram_release(config: dict[str, Any]) -> None:
    deadline = time.monotonic() + int(config["release_timeout_seconds"])
    ceiling = int(config["released_vram_ceiling_mb"])
    while time.monotonic() < deadline:
        used = gpu_snapshot()["memory_used_mb"]
        if used is not None and used <= ceiling:
            return
        time.sleep(1)
    used = gpu_snapshot()["memory_used_mb"]
    raise ControllerError(f"GPU memory did not fall below {ceiling} MiB; still using {used} MiB")


def request_bytes(url: str, *, timeout: float, payload: dict[str, Any] | None = None) -> tuple[str, bytes]:
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.headers.get("content-type", ""), response.read()


def wait_for_http(url: str, timeout: int) -> None:
    deadline = time.monotonic() + timeout
    last_error = "not attempted"
    while time.monotonic() < deadline:
        try:
            _, body = request_bytes(url, timeout=5)
            if body:
                return
        except Exception as exc:
            last_error = str(exc)
        time.sleep(1)
    raise ControllerError(f"readiness check timed out for {url}: {last_error}")


def ready_target(mode: str, config: dict[str, Any]) -> dict[str, Any]:
    timeout = int(config["readiness_timeout_seconds"])
    if mode == "llm":
        wait_for_http(str(config["bonsai_url"]), timeout)
        _, body = request_bytes(
            str(config["bonsai_completion_url"]),
            timeout=timeout,
            payload={
                "model": "bonsai-27b",
                "messages": [{"role": "user", "content": "Reply OK"}],
                "max_tokens": 4,
                "temperature": 0,
            },
        )
        try:
            completion = json.loads(body)
            if not completion.get("choices"):
                raise ValueError("missing choices")
        except (json.JSONDecodeError, ValueError) as exc:
            raise ControllerError(f"Bonsai readiness inference was invalid: {exc}") from exc
        return {"check": "bonsai-inference", "ready": True}
    if mode == "image":
        wait_for_http(str(config["comfyui_url"]), timeout)
        return {"check": "comfyui-system-stats", "ready": True}
    if mode == "voice":
        base_url = str(config["voicebox_url"]).rstrip("/")
        wait_for_http(f"{base_url}/health", timeout)
        content_type, body = request_bytes(
            f"{base_url}/generate/stream",
            timeout=timeout,
            payload={
                "profile_id": config["voicebox_profile_id"],
                "text": "GPU voice mode ready.",
                "language": "en",
                "engine": config["voicebox_engine"],
                "normalize": False,
            },
        )
        if len(body) < 1024 or ("audio" not in content_type and not body.startswith(b"RIFF")):
            raise ControllerError(
                f"Voicebox warm-up returned non-audio content ({content_type}, {len(body)} bytes)"
            )
        return {"check": "voicebox-generation", "ready": True, "audio_bytes": len(body)}
    return {"check": "all-services-stopped", "ready": True}


def switch_mode(requested: str) -> dict[str, Any]:
    config = load_config()
    before = status_payload()
    if before["mode"] == requested and requested != "mixed":
        # Reassert boot policy even if someone manually changed enablement.
        for name in SERVICES:
            should_enable = requested != "idle" and name == requested
            if before["services"][name]["enabled"] != should_enable:
                pct(name, "systemctl", "enable" if should_enable else "disable", SERVICES[name]["unit"])
        readiness = ready_target(requested, config)
        return {
            **status_payload(),
            "changed": False,
            "requested_mode": requested,
            "readiness": readiness,
            "message": f"GPU is already in {requested} mode",
        }

    stop_everything()
    wait_for_vram_release(config)
    if requested != "idle":
        set_service(requested, True)
    try:
        readiness = ready_target(requested, config)
    except Exception:
        stop_everything()
        write_state("idle")
        raise
    write_state(requested)
    return {
        **status_payload(),
        "changed": True,
        "requested_mode": requested,
        "readiness": readiness,
        "message": f"GPU switched to {requested} mode",
    }


def emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, sort_keys=True))


def main() -> int:
    parser = argparse.ArgumentParser(description="Switch the shared RTX 3060 between exclusive workloads")
    parser.add_argument("mode", choices=("status", *MODES))
    args = parser.parse_args()

    if fcntl is None:
        raise RuntimeError("optimus-gpu-controller requires a POSIX host")

    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LOCK_PATH.open("a+", encoding="utf-8") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        try:
            emit(status_payload() if args.mode == "status" else switch_mode(args.mode))
            return 0
        except (ControllerError, urllib.error.URLError, TimeoutError, subprocess.TimeoutExpired) as exc:
            payload = status_payload()
            payload.update({"ok": False, "requested_mode": args.mode, "error": str(exc)})
            emit(payload)
            return 1


if __name__ == "__main__":
    sys.exit(main())
