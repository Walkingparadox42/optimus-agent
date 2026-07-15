from pathlib import Path
from tempfile import TemporaryDirectory
import os
import unittest

from botvault_voice import is_botvault_open_intent, resolve_botvault_note


class BotVaultVoiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.root = Path(self.temp.name)
        paths = [
            "Optimus/SCHEMA.md",
            "Optimus/Omega Squad/The Valdori/The Valdori.md",
            "Optimus/Omega Squad/The Valdori/The Valdori and the Vedas.md",
            "Optimus/Omega Squad/Game Session 7-11-26 brainstorm.md",
            "Optimus/projects/incubating/optimus-monetization.md",
            "Optimus/projects/incubating/fishing-boats.md",
            "pricing/older-item.md",
            "pricing/newest-item.md",
        ]
        for index, relative in enumerate(paths):
            path = self.root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(relative, encoding="utf-8")
            os.utime(path, ns=(1_000_000_000 + index, 1_000_000_000 + index))

    def tearDown(self) -> None:
        self.temp.cleanup()

    def resolves(self, speech: str) -> str | None:
        result = resolve_botvault_note(speech, self.root)

        return Path(result).relative_to(self.root).as_posix() if result else None

    def test_intent_accepts_casual_speech_without_botvault_wording(self) -> None:
        self.assertTrue(is_botvault_open_intent("Can you call up the latest pricing file?"))
        self.assertTrue(is_botvault_open_intent("Pull up the Val Dory note"))
        self.assertTrue(is_botvault_open_intent("Lemme see fishing boats"))
        self.assertTrue(is_botvault_open_intent("Open fishing-boats.md in the incubating folder"))
        self.assertFalse(is_botvault_open_intent("How are you doing, Optimus?"))

    def test_resolves_failed_live_valdori_transcripts(self) -> None:
        expected = "Optimus/Omega Squad/The Valdori/The Valdori.md"
        self.assertEqual(self.resolves("Call up the Val Dory note"), expected)
        self.assertEqual(self.resolves("Display valdory.md in the Bot Vault pane"), expected)
        self.assertEqual(self.resolves("It's V-A-L-D-O-R-I"), expected)

    def test_resolves_clear_note_and_folder_names(self) -> None:
        self.assertEqual(
            self.resolves("Open fishing-boats.md in the incubating folder on the Botfall pane"),
            "Optimus/projects/incubating/fishing-boats.md",
        )
        self.assertEqual(
            self.resolves("Call up Optimus monetization"),
            "Optimus/projects/incubating/optimus-monetization.md",
        )
        self.assertEqual(self.resolves("Open schema"), "Optimus/SCHEMA.md")

    def test_latest_folder_request_uses_modification_time(self) -> None:
        self.assertEqual(
            self.resolves("Can you call up the latest pricing file from the pricing projects?"),
            "pricing/newest-item.md",
        )

    def test_low_confidence_prose_does_not_open_a_random_note(self) -> None:
        self.assertIsNone(self.resolves("That thing we talked about yesterday"))


if __name__ == "__main__":
    unittest.main()
