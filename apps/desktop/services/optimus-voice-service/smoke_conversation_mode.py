#!/usr/bin/env python3
"""Live CT115 check that Conversation Mode survives a thinking pause."""

import asyncio
import math
import os
import struct
import time
import uuid

import aiohttp


RATE = 16_000
TOKEN_FILE = os.environ.get("OPTIMUS_VOICE_TOKEN_FILE", "/etc/optimus/voice-token")
URL = os.environ.get("OPTIMUS_VOICE_URL", "ws://127.0.0.1:9125/voice")


def frame(sequence: int, pcm: bytes) -> bytes:
    return struct.pack("<4sBBHII", b"OVX1", 1, 0, 0, 0, sequence) + pcm


def tone(seconds: float = 0.8) -> bytes:
    samples = [int(5_000 * math.sin(2 * math.pi * 220 * index / RATE)) for index in range(int(RATE * seconds))]
    return struct.pack(f"<{len(samples)}h", *samples)


async def main() -> None:
    token = open(TOKEN_FILE, encoding="utf-8").read().strip()
    session_id = f"conversation-smoke-{uuid.uuid4().hex[:8]}"
    async with aiohttp.ClientSession() as http:
        async with http.ws_connect(f"{URL}?token={token}", compress=0) as websocket:
            await websocket.send_json({"message": "session.start", "mode": "conversation_active", "session_id": session_id})
            ready = await websocket.receive_json(timeout=10)
            assert ready["message"] == "session.ready", ready

            await websocket.send_json({"message": "session.mode.set", "mode": "conversation_mode"})
            pcm = tone()
            sequence = 0
            for offset in range(0, len(pcm), 3_200):
                await websocket.send_bytes(frame(sequence, pcm[offset : offset + 3_200]))
                sequence += 1

            # Every ordinary mode endpoints by two seconds. Conversation Mode
            # must still be capturing after a deliberate three-second pause.
            pause_deadline = time.monotonic() + 3.2
            while time.monotonic() < pause_deadline:
                remaining = pause_deadline - time.monotonic()
                try:
                    message = await websocket.receive_json(timeout=min(0.5, remaining))
                except asyncio.TimeoutError:
                    continue
                assert message.get("message") != "stt.final", (
                    "Conversation Mode ended during a three-second thinking pause",
                    message,
                )

            await websocket.send_json({"message": "audio.input.commit"})
            while True:
                message = await websocket.receive_json(timeout=15)
                if message.get("message") == "stt.final":
                    assert message.get("endpoint_source") == "commit", message
                    break

            await websocket.send_json({"message": "session.end"})
    print("PASS conversation mode stayed open through a 3.2s thinking pause")


if __name__ == "__main__":
    asyncio.run(main())
