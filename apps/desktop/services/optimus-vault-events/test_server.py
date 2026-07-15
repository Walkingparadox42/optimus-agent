from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from server import NoteState, diff_snapshots, snapshot_notes


class SnapshotTests(unittest.TestCase):
    def test_snapshot_includes_notes_and_ignores_internal_directories(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "notes").mkdir()
            (root / "notes" / "one.md").write_text("hello", encoding="utf-8")
            (root / "notes" / "image.png").write_bytes(b"png")
            (root / ".obsidian").mkdir()
            (root / ".obsidian" / "hidden.md").write_text("internal", encoding="utf-8")

            snapshot = snapshot_notes(root)

            self.assertEqual(list(snapshot), [str(root / "notes" / "one.md")])

    def test_diff_reports_create_modify_and_delete(self) -> None:
        previous = {
            "/vault/deleted.md": NoteState(1, 1),
            "/vault/modified.md": NoteState(1, 1),
        }
        current = {
            "/vault/created.md": NoteState(2, 2),
            "/vault/modified.md": NoteState(2, 3),
        }

        events = diff_snapshots(previous, current)

        self.assertEqual(
            [(event["kind"], event["path"]) for event in events],
            [
                ("created", "/vault/created.md"),
                ("deleted", "/vault/deleted.md"),
                ("modified", "/vault/modified.md"),
            ],
        )


if __name__ == "__main__":
    unittest.main()
