#!/usr/bin/env python3
"""Authenticated CT115 WebSocket smoke test for casual BotVault speech."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
import uuid

import aiohttp


TOKEN = Path("/etc/optimus/voice-token").read_text(encoding="utf-8").strip()
URL = f"ws://127.0.0.1:9125/voice?token={TOKEN}"

CASES = {
    "Call up the Val Dory note": "/mnt/vaults/BotVault/Optimus/Omega Squad/The Valdori/The Valdori.md",
    "Can you call up the latest pricing file from the pricing projects?":
        "/mnt/vaults/BotVault/pricing/stamina-ats-air-rower-1399-2026-06-27.md",
}


async def run_case(http: aiohttp.ClientSession, speech: str, expected: str) -> None:
    session_id = f"botvault-smoke-{uuid.uuid4().hex[:8]}"
    async with http.ws_connect(URL, compress=0) as websocket:
        await websocket.send_json({"message": "session.start", "mode": "conversation_active", "session_id": session_id})
        await websocket.receive_json(timeout=10)
        await websocket.send_json({"message": "text.input", "session_id": session_id, "text": speech})

        while True:
            message = await websocket.receive(timeout=30)
            if message.type != aiohttp.WSMsgType.TEXT:
                continue

            payload = json.loads(message.data)
            if payload.get("message") != "tool.result":
                continue

            actual = (payload.get("args") or {}).get("path")
            if actual != expected:
                raise AssertionError(f"{speech!r}: expected {expected!r}, got {actual!r}")

            print(f"PASS {speech!r} -> {actual}")
            return


async def run_followup_case(http: aiohttp.ClientSession) -> None:
    session_id = f"botvault-smoke-{uuid.uuid4().hex[:8]}"
    expected = "/mnt/vaults/BotVault/Optimus/projects/incubating/optimus-monetization.md"
    async with http.ws_connect(URL, compress=0) as websocket:
        await websocket.send_json({"message": "session.start", "mode": "conversation_active", "session_id": session_id})
        await websocket.receive_json(timeout=10)
        await websocket.send_json({"message": "text.input", "session_id": session_id, "text": "Open that up in BotVault"})

        while True:
            message = await websocket.receive(timeout=30)
            if message.type == aiohttp.WSMsgType.TEXT and json.loads(message.data).get("message") == "response.done":
                break

        await websocket.send_json({"message": "text.input", "session_id": session_id, "text": "That Optimus Monetization MD"})
        while True:
            message = await websocket.receive(timeout=30)
            if message.type != aiohttp.WSMsgType.TEXT:
                continue
            payload = json.loads(message.data)
            if payload.get("message") == "tool.result":
                actual = (payload.get("args") or {}).get("path")
                if actual != expected:
                    raise AssertionError(f"follow-up: expected {expected!r}, got {actual!r}")
                print(f"PASS conversational follow-up -> {actual}")
                return


async def main() -> None:
    async with aiohttp.ClientSession() as http:
        for speech, expected in CASES.items():
            await run_case(http, speech, expected)
        await run_followup_case(http)


if __name__ == "__main__":
    asyncio.run(main())
