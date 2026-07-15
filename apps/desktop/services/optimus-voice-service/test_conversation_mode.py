import unittest

from conversation_mode import (
    MAX_UTTERANCE_DEFAULT_S,
    SILENCE_DEFAULT_S,
    SILENCE_WINDOWS,
    max_utterance_seconds,
    silence_window_seconds,
)


class ConversationModePolicyTests(unittest.TestCase):
    def test_conversation_mode_has_the_longest_silence_window(self):
        conversation = silence_window_seconds("conversation_mode")
        peers = [window for mode, window in SILENCE_WINDOWS.items() if mode != "conversation_mode"]
        self.assertGreater(conversation, max(peers))
        self.assertEqual(conversation, 8.0)

    def test_conversation_mode_allows_a_five_minute_utterance(self):
        self.assertEqual(max_utterance_seconds("conversation_mode"), 300.0)
        self.assertGreater(max_utterance_seconds("conversation_mode"), MAX_UTTERANCE_DEFAULT_S)

    def test_existing_and_unknown_modes_keep_the_fast_defaults(self):
        self.assertEqual(silence_window_seconds("listening_for_turn"), 1.2)
        self.assertEqual(silence_window_seconds("unknown"), SILENCE_DEFAULT_S)
        self.assertEqual(max_utterance_seconds("waiting_for_followup"), MAX_UTTERANCE_DEFAULT_S)


if __name__ == "__main__":
    unittest.main()
