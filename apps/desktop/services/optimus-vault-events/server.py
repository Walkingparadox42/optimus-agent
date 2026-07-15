#!/usr/bin/env python3
"""Authoritative BotVault note-change feed for Optimus Cockpit.

The desktop's Hermes tool stream only describes work performed by that exact
chat connection.  This service watches the vault itself, so writes from voice,
subagents, cron jobs, terminal commands, Obsidian, and desktop chat all produce
the same event.  It intentionally reports facts only; changing the selected
note remains an explicit UI command.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable

if TYPE_CHECKING:
    from websockets.asyncio.server import ServerConnection
else:
    ServerConnection = Any


VAULT_ROOT = Path(os.environ.get("OPTIMUS_BOTVAULT_PATH", "/mnt/vaults/BotVault"))
HOST = os.environ.get("OPTIMUS_VAULT_EVENTS_HOST", "0.0.0.0")
PORT = int(os.environ.get("OPTIMUS_VAULT_EVENTS_PORT", "9128"))
SCAN_INTERVAL_SECONDS = float(os.environ.get("OPTIMUS_VAULT_EVENTS_SCAN_INTERVAL", "0.6"))
IGNORED_DIRS = frozenset({".git", ".obsidian", ".trash"})


@dataclass(frozen=True)
class NoteState:
    mtime_ns: int
    size: int


Snapshot = dict[str, NoteState]


def snapshot_notes(root: Path) -> Snapshot:
    """Return a stable path -> metadata view of Markdown notes under *root*."""
    notes: Snapshot = {}

    for directory, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name not in IGNORED_DIRS]
        base = Path(directory)

        for filename in filenames:
            if not filename.lower().endswith(".md"):
                continue

            path = base / filename
            try:
                stat = path.stat()
            except (FileNotFoundError, PermissionError, OSError):
                # A file can disappear between os.walk and stat during an
                # atomic save. The next scan sees its settled state.
                continue

            notes[str(path)] = NoteState(mtime_ns=stat.st_mtime_ns, size=stat.st_size)

    return notes


def diff_snapshots(previous: Snapshot, current: Snapshot) -> list[dict[str, object]]:
    now_ms = int(time.time() * 1000)
    events: list[dict[str, object]] = []

    for path in sorted(current.keys() - previous.keys()):
        events.append({"kind": "created", "path": path, "timestamp": now_ms})

    for path in sorted(previous.keys() - current.keys()):
        events.append({"kind": "deleted", "path": path, "timestamp": now_ms})

    for path in sorted(current.keys() & previous.keys()):
        if current[path] != previous[path]:
            events.append({"kind": "modified", "path": path, "timestamp": now_ms})

    return events


class VaultEventService:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.clients: set[ServerConnection] = set()
        self.stop = asyncio.Event()

    async def handler(self, websocket: ServerConnection) -> None:
        self.clients.add(websocket)
        try:
            await websocket.send(
                json.dumps(
                    {
                        "type": "ready",
                        "root": str(self.root),
                        "timestamp": int(time.time() * 1000),
                    }
                )
            )
            await websocket.wait_closed()
        finally:
            self.clients.discard(websocket)

    async def broadcast(self, events: Iterable[dict[str, object]]) -> None:
        payloads = [json.dumps({"type": "note.changed", **event}) for event in events]
        if not payloads or not self.clients:
            return

        dead: set[ServerConnection] = set()
        for client in tuple(self.clients):
            try:
                for payload in payloads:
                    await client.send(payload)
            except Exception:
                dead.add(client)
        self.clients.difference_update(dead)

    async def watch(self) -> None:
        previous = await asyncio.to_thread(snapshot_notes, self.root)
        logging.info("watching %s (%d notes)", self.root, len(previous))

        while not self.stop.is_set():
            try:
                await asyncio.wait_for(self.stop.wait(), timeout=SCAN_INTERVAL_SECONDS)
                break
            except TimeoutError:
                pass

            current = await asyncio.to_thread(snapshot_notes, self.root)
            events = diff_snapshots(previous, current)
            previous = current

            if events:
                logging.info("vault changes: %s", events)
                await self.broadcast(events)


async def main() -> None:
    from websockets.asyncio.server import serve

    if not VAULT_ROOT.is_dir():
        raise SystemExit(f"BotVault path is not a directory: {VAULT_ROOT}")

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    service = VaultEventService(VAULT_ROOT)
    loop = asyncio.get_running_loop()

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, service.stop.set)

    async with serve(service.handler, HOST, PORT, ping_interval=20, ping_timeout=20):
        logging.info("BotVault event feed listening on ws://%s:%d/events", HOST, PORT)
        await service.watch()


if __name__ == "__main__":
    asyncio.run(main())
