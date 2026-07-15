import unittest

from transcript_gate import should_drop_transcript


class TranscriptGateTests(unittest.TestCase):
    def test_drops_fillers_and_tiny_transcripts(self):
        for text in ("", "of", "uh", "ummm", "hmm"):
            with self.subTest(text=text):
                self.assertTrue(should_drop_transcript(text, 0.5))

    def test_drops_impossible_half_second_hallucinations_seen_live(self):
        self.assertTrue(should_drop_transcript("a a a a a a a", 0.5))
        self.assertTrue(should_drop_transcript("of 2 3 3 4 1 2 3 3 4 3 4 5", 0.5))

    def test_preserves_plausible_short_and_normal_speech(self):
        self.assertFalse(should_drop_transcript("yes please", 0.5))
        self.assertFalse(should_drop_transcript("one two three four five six", 0.8))
        self.assertFalse(should_drop_transcript("I need some time to think before I answer this", 3.0))


if __name__ == "__main__":
    unittest.main()
