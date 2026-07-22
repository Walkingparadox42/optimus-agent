from __future__ import annotations

import unittest

from meeting_summary import build_meeting_summary_prompt, normalize_summary_style


class MeetingSummaryPromptTests(unittest.TestCase):
    def test_unknown_style_rolls_back_to_standard_meeting(self) -> None:
        self.assertEqual(normalize_summary_style(None), "meeting")
        self.assertEqual(normalize_summary_style("unknown"), "meeting")
        prompt = build_meeting_summary_prompt("/vault/note.md", "Transcript", 60, summary_style="unknown")
        self.assertIn("### Decisions", prompt)
        self.assertIn("If attribution is unclear, write unattributed action items.", prompt)
        self.assertNotIn("### Detailed Question Responses", prompt)

    def test_interview_profile_prioritizes_candidate_answer_substance(self) -> None:
        prompt = build_meeting_summary_prompt(
            "/vault/interview.md",
            "How would you restructure the RAG? I would separate ingestion from retrieval.",
            600,
            "Full-stack developer interview",
            "interview",
        )
        self.assertIn("candidate's substantive answers are the primary evidence", prompt)
        self.assertIn("Do not write empty descriptions", prompt)
        self.assertIn("the candidate answered the RAG", prompt)
        self.assertIn("### Detailed Question Responses", prompt)
        self.assertIn("### Concerns or Gaps", prompt)
        self.assertIn("Preserve the full Transcript section text", prompt)

    def test_profiles_share_durability_and_attribution_rules(self) -> None:
        for style in ("meeting", "interview"):
            prompt = build_meeting_summary_prompt("/vault/note.md", "Raw words", 90, "Context", style)
            self.assertIn("Update exactly this file: /vault/note.md", prompt)
            self.assertIn("Do not invent speaker names", prompt)
            self.assertIn("```text\nRaw words\n```", prompt)


if __name__ == "__main__":
    unittest.main()
