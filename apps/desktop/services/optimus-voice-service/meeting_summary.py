"""Versioned meeting-recorder summary prompts.

The standard profile intentionally preserves the original M2 behavior. The
interview profile changes only summarization priorities; recording,
transcription, note creation, and the immutable Transcript section are shared.
"""

from __future__ import annotations


SUMMARY_STYLES = frozenset({"interview", "meeting"})


def normalize_summary_style(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    return normalized if normalized in SUMMARY_STYLES else "meeting"


def _shared_header(note_path: str, meeting_context: str) -> str:
    return f"""You are Hermes, updating an Optimus BotVault meeting transcript note.

Task:
- Update exactly this file: {note_path}
- Preserve the existing YAML frontmatter exactly unless a correction is required by the existing schema.
- Preserve the full Transcript section text.
- Replace the current Summary placeholder with a useful meeting summary.
- Preserve the existing Meeting context line above the Summary section.
- Use the meeting context below as authoritative framing for the title, overview, and action items.
- Do not invent speaker names; this transcript has no speaker diarization. If attribution is unclear, write unattributed action items.
- Keep the note schema-conformant.

Meeting context supplied by Steve after recording stopped: {meeting_context}
"""


def _standard_prompt(note_path: str, transcript: str, dur_min: str, meeting_context: str) -> str:
    return _shared_header(note_path, meeting_context) + f"""
Use this Summary structure:
## Summary

### Context
{meeting_context}

### Overview
A concise paragraph.

### Decisions
- Decision bullets, or "None captured."

### Action Items
- Bullets in the form "Owner: task" when the owner is explicit; otherwise "Unattributed: task". If none, "None captured."

### Open Questions
- Question bullets, or "None captured."

### Notable Details
- Any important details worth preserving, or "None captured."

Duration: {dur_min}

Transcript:
```text
{transcript}
```

After writing the file, reply with only the final note path and a one-line status.
"""


def _interview_prompt(note_path: str, transcript: str, dur_min: str, meeting_context: str) -> str:
    return _shared_header(note_path, meeting_context) + f"""
This is an INTERVIEW summary. The interviewer's questions provide context, but
the candidate's substantive answers are the primary evidence. Infer question
and answer boundaries from conversational flow only when reasonably clear.
Because the transcript has no speaker labels, use "candidate" only when the
role is supported by that flow; otherwise label the material "Attribution
uncertain." Never assign Steve's ideas or leading statements to the candidate.

Depth requirements:
- For every substantive interview question, preserve what the candidate
  actually proposed, how they reasoned, tradeoffs they identified, concrete
  technologies or examples they used, and caveats or limitations they raised.
- Do not write empty descriptions such as "the candidate answered the RAG
  question," "discussed the topic," or "showed understanding." State the
  substance of the answer. If no substantive answer is captured, say exactly
  that.
- Separate evidence from assessment. Every strength, concern, or signal must
  point back to specific transcript content. Do not invent missing details.
- Depth should scale with the transcript. Do not compress a multi-part
  technical answer into one sentence merely to keep the summary short.

Use this Summary structure:
## Summary

### Interview Context
{meeting_context}

### Candidate Overview
Two to four paragraphs centered on the candidate's experience, approach, and
technical thinking demonstrated in this interview.

### Detailed Question Responses
Create one subsection per substantive question or topic. Use a descriptive
heading, then capture:
- **Question / scenario:** What the interviewer was testing.
- **Candidate response:** The actual proposed approach and sequence.
- **Reasoning and tradeoffs:** Why, alternatives considered, and compromises.
- **Specifics:** Technologies, architecture, examples, metrics, or operational details mentioned.
- **Gaps / uncertainty:** Missing depth, unclear attribution, or unanswered portions.
Omit a field only when it truly does not apply; do not fill gaps by inference.

### Technical Strengths
- Evidence-grounded strengths, or "None clearly demonstrated in the transcript."

### Concerns or Gaps
- Evidence-grounded weaknesses, omissions, contradictions, or areas that need validation, or "None clearly captured."

### Recommended Follow-Ups
- Targeted questions that would resolve the identified gaps or test important claims, or "None."

### Action Items
- Interview-process follow-ups only. Use "Owner: task" when explicit; otherwise "Unattributed: task". If none, "None captured."

Duration: {dur_min}

Transcript:
```text
{transcript}
```

After writing the file, reply with only the final note path and a one-line status.
"""


def build_meeting_summary_prompt(
    note_path: str,
    transcript: str,
    duration_s: float,
    title: str = "",
    summary_style: str = "meeting",
) -> str:
    dur_min = f"{duration_s / 60:.1f} minutes" if duration_s else "unknown duration"
    meeting_context = (title or "").strip() or "Not provided."
    style = normalize_summary_style(summary_style)

    if style == "interview":
        return _interview_prompt(note_path, transcript, dur_min, meeting_context)
    return _standard_prompt(note_path, transcript, dur_min, meeting_context)
