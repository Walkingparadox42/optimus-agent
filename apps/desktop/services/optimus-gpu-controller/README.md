# Optimus GPU controller

Exclusive workload switching for the RTX 3060 passed through by Urithiru.

The system has two layers:

- Urithiru runs `controller.py` as `/usr/local/sbin/optimus-gpu-controller`.
  It is the only layer allowed to call `pct` and change container services.
- CT115 runs the `optimus-gpu` client and the `optimus-gpu-mode` Hermes skill.
  A restricted SSH key can invoke only the five allowlisted commands through
  `optimus-gpu-ssh`; it cannot obtain a shell or run arbitrary host commands.

## Modes

| Mode | Enabled service | Services disabled and stopped |
| --- | --- | --- |
| `image` | CT120 `comfyui.service` | Bonsai |
| `llm` | CT102 `bonsai.service` | ComfyUI |
| `idle` | none | both services |

Every transition is serialized with a host lock. The controller stops all GPU
consumers, waits for VRAM release, starts the selected service, and runs a
workload-specific readiness check. LLM readiness includes a short Bonsai
inference rather than only checking its HTTP health endpoint. ComfyUI
readiness uses its live system-stats API because image generation requires a
user-selected workflow. Voice synthesis is no longer a GPU workload: Piper
Prime runs continuously on CT115 CPU outside this controller.
If readiness fails, the controller returns to `idle` rather than leaving a
partially initialized mode active.

Mode selection also updates systemd enablement, preventing all three services
from racing for the GPU after a reboot.

## Stable CT115 contract

```text
optimus-gpu status
optimus-gpu image
optimus-gpu llm
optimus-gpu idle
```

Output is one JSON object. `ok: true` plus the requested `mode` is the success
contract for Hermes and future cockpit controls.

## Live deployment

Deployed 2026-07-15:

- Urithiru: `/usr/local/sbin/optimus-gpu-controller` and
  `/usr/local/sbin/optimus-gpu-ssh`.
- CT115: `/usr/local/bin/optimus-gpu`.
- CT115 Hermes skill: `/root/.hermes/skills/optimus-gpu-mode/SKILL.md`.
- CT115 restricted key material: `/etc/optimus-gpu-controller/`.

The host `authorized_keys` entry is restricted to `optimus-gpu-ssh`; a live
negative test confirmed arbitrary commands are rejected with exit 64. The
pre-deployment host key file is backed up as
`/root/.ssh/authorized_keys.bak-optimus-gpu-20260715`.

The original 2026-07-15 acceptance covered Voicebox, ComfyUI, Bonsai, and idle.
Voicebox was retired on 2026-07-17 after Piper Prime became CT115's primary
voice. Current acceptance covers ComfyUI system stats, a real Bonsai
inference, idle VRAM release, and independent Piper voice synthesis.

## Local tests

```bash
cd apps/desktop/services/optimus-gpu-controller
python -m unittest test_controller.py
```
