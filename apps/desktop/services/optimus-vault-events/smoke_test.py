#!/usr/bin/env python3
"""End-to-end probe: connect, change a temporary note, observe the event."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
import time

from websockets.asyncio.client import connect


URL = "ws://127.0.0.1:9128/events"
PROBE = Path("/mnt/vaults/BotVault/.optimus-vault-events-smoke.md")


async def main() -> None:
    try:
        async with connect(URL) as websocket:
            ready = json.loads(await asyncio.wait_for(websocket.recv(), timeout=3))
            if ready.get("type") != "ready":
                raise RuntimeError(f"unexpected ready payload: {ready}")

            PROBE.write_text(f"watcher smoke test {time.time_ns()}\n", encoding="utf-8")

            while True:
                event = json.loads(await asyncio.wait_for(websocket.recv(), timeout=5))
                if event.get("type") == "note.changed" and event.get("path") == str(PROBE):
                    print(json.dumps(event, sort_keys=True))
                    break
    finally:
        PROBE.unlink(missing_ok=True)


if __name__ == "__main__":
    asyncio.run(main())
