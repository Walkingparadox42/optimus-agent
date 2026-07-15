#!/usr/bin/env python3
"""Authenticated CT115 smoke test for avatar canvas-pane tool arguments."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
import uuid

import aiohttp


TOKEN = Path("/etc/optimus/voice-token").read_text(encoding="utf-8").strip()
URL = f"ws://127.0.0.1:9125/voice?token={TOKEN}"


async def main() -> None:
    session_id = f"canvas-pane-smoke-{uuid.uuid4().hex[:8]}"

    async with aiohttp.ClientSession() as http:
        async with http.ws_connect(URL, compress=0) as websocket:
            await websocket.send_json(
                {"message": "session.start", "mode": "conversation_active", "session_id": session_id}
            )
            await websocket.receive_json(timeout=10)
            await websocket.send_json(
                {"message": "text.input", "session_id": session_id, "text": "Close the browser pane."}
            )

            while True:
                message = await websocket.receive(timeout=90)
                if message.type != aiohttp.WSMsgType.TEXT:
                    continue

                payload = json.loads(message.data)
                if payload.get("message") != "tool.started":
                    continue
                if "optimus_cockpit_panel" not in str(payload.get("tool", "")):
                    continue

                args = payload.get("args") or {}
                expected = {"action": "close", "panel": "browser"}
                if args.get("action") != expected["action"] or args.get("panel") != expected["panel"]:
                    raise AssertionError(f"expected {expected!r}, got {args!r}")

                print(f"PASS avatar pane command -> {args}")
                return


if __name__ == "__main__":
    asyncio.run(main())
