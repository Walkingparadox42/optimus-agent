"""Endpointing policy for patient Conversation Mode."""

SILENCE_WINDOWS = {
    "listening_for_turn": 1.2,
    "conversation_active": 1.5,
    "session_active": 2.0,
    "waiting_for_followup": 2.0,
    "conversation_mode": 8.0,
}
SILENCE_DEFAULT_S = 1.5

MAX_UTTERANCE_DEFAULT_S = 30.0
MAX_UTTERANCE_WINDOWS = {
    "conversation_mode": 300.0,
}


def silence_window_seconds(mode: str) -> float:
    return SILENCE_WINDOWS.get(mode, SILENCE_DEFAULT_S)


def max_utterance_seconds(mode: str) -> float:
    return MAX_UTTERANCE_WINDOWS.get(mode, MAX_UTTERANCE_DEFAULT_S)
