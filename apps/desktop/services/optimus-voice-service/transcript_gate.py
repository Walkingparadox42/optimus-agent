"""Reject filler and physically implausible short-audio STT hallucinations."""

import math
import re


MIN_CHARS = 3
FILLER_ONLY = re.compile(r"^[\s.,!?\-]*(uh+|um+|hmm+|ah+|eh+|you)?[\s.,!?\-]*$", re.I)
TOKEN = re.compile(r"[a-z0-9']+", re.I)
MAX_PLAUSIBLE_TOKENS_PER_SECOND = 6
MIN_TOKEN_ALLOWANCE = 6


def should_drop_transcript(text: str, audio_seconds: float) -> bool:
    stripped = text.strip()
    if len(stripped) < MIN_CHARS or FILLER_ONLY.fullmatch(stripped):
        return True

    tokens = TOKEN.findall(stripped)
    plausible_limit = max(
        MIN_TOKEN_ALLOWANCE,
        math.ceil(max(0.0, audio_seconds) * MAX_PLAUSIBLE_TOKENS_PER_SECOND),
    )
    return len(tokens) > plausible_limit
