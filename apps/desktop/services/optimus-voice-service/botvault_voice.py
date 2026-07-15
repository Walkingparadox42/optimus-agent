"""Voice-first BotVault open intent and fuzzy note resolution.

This is deliberately deterministic and local. Casual speech and STT variants
should resolve without burning a Hermes turn, while low-confidence matches
return ``None`` instead of opening the wrong note.
"""

from __future__ import annotations

from difflib import SequenceMatcher
import os
from pathlib import Path
import re


STRONG_OPEN_RE = re.compile(
    r"\b(?:call|pull|bring|pop|fire)\s+(?:it\s+|that\s+|this\s+)?up\b|"
    r"\b(?:let\s+me|lemme)\s+(?:see|look\s+at)\b",
    re.I,
)
GENERAL_OPEN_RE = re.compile(r"\b(?:open|show|load|display)\b|\bput\b.*\bup\b", re.I)
BOTVAULT_CONTEXT_RE = re.compile(r"\b(?:bot\s*vault|botvault|botfall|canvas)\b", re.I)
NOTE_CONTEXT_RE = re.compile(r"\b(?:note|noted|file|document|doc|folder)\b|\bmd\b|\.md\b", re.I)

STOPWORDS = {
    "a", "about", "again", "and", "app", "at", "bot", "botfall", "botvault",
    "bring", "call", "can", "canvas", "could", "desktop", "display", "doc",
    "document", "file", "folder", "for", "from", "get", "have", "herm",
    "hermes", "i", "in", "into", "it", "latest", "let", "load", "look",
    "md", "me", "need", "note", "noted", "of", "on", "open", "opened",
    "optimus", "pane", "please", "pop", "project", "projects", "pull", "put",
    "see", "show", "specific", "that", "the", "this", "to", "up", "vault",
    "want", "we", "with", "would", "you",
}


def is_botvault_open_intent(text: str) -> bool:
    """Recognize natural requests without requiring the words 'BotVault pane'."""
    if STRONG_OPEN_RE.search(text):
        return True

    return bool(GENERAL_OPEN_RE.search(text) and (BOTVAULT_CONTEXT_RE.search(text) or NOTE_CONTEXT_RE.search(text)))


def _collapse_spelled_letters(text: str) -> str:
    # "V-A-L-D-O-R-I" / "V A L D O R I" -> "valdori" before tokenizing.
    pattern = re.compile(r"(?<![A-Za-z])(?:[A-Za-z][\s.-]+){2,}[A-Za-z](?![A-Za-z])")

    return pattern.sub(lambda match: re.sub(r"[^A-Za-z]", "", match.group(0)), text)


def _tokens(text: str) -> list[str]:
    raw = re.findall(r"[a-z0-9]+", _collapse_spelled_letters(text).lower())
    useful = [token for token in raw if token not in STOPWORDS and (len(token) > 1 or token.isdigit())]

    return useful


def _joined_phrases(tokens: list[str], max_words: int = 4) -> set[str]:
    phrases: set[str] = set()

    for start in range(len(tokens)):
        for width in range(1, min(max_words, len(tokens) - start) + 1):
            phrases.add("".join(tokens[start : start + width]))

    return phrases


def _path_tokens(path: Path, root: Path) -> tuple[list[str], list[str]]:
    name = re.findall(r"[a-z0-9]+", path.stem.lower())
    relative = path.relative_to(root)
    folders = re.findall(r"[a-z0-9]+", " ".join(relative.parts[:-1]).lower())

    return name, folders


def _candidate_score(path: Path, root: Path, query: list[str], phrases: set[str]) -> tuple[float, int, int]:
    name_tokens, folder_tokens = _path_tokens(path, root)
    core_name = name_tokens[1:] if name_tokens[:1] == ["the"] else name_tokens
    name_forms = {"".join(name_tokens), "".join(core_name), *name_tokens}
    name_forms.discard("")

    best_ratio = max(
        (SequenceMatcher(None, phrase, form).ratio() for phrase in phrases for form in name_forms),
        default=0.0,
    )
    name_overlap = sum(1 for token in set(query) if token in name_tokens)
    folder_overlap = sum(1 for token in set(query) if token in folder_tokens)
    extra_name_words = max(0, len(core_name) - len(query))
    score = best_ratio * 100 + name_overlap * 12 + folder_overlap * 5 - extra_name_words * 2

    return score, name_overlap, folder_overlap


def resolve_botvault_note(text: str, root_value: str | Path) -> str | None:
    root = Path(root_value)
    if not root.is_dir():
        return None

    query = _tokens(text)
    if not query:
        return None

    phrases = _joined_phrases(query)
    wants_latest = bool(re.search(r"\b(?:latest|newest|most\s+recent|last)\b", text, re.I))
    ranked: list[tuple[float, int, int, int, Path]] = []

    for path in root.rglob("*.md"):
        try:
            score, name_overlap, folder_overlap = _candidate_score(path, root, query, phrases)
            mtime_ns = path.stat().st_mtime_ns
        except (OSError, ValueError):
            continue

        ranked.append((score, name_overlap, folder_overlap, mtime_ns, path))

    if not ranked:
        return None

    # "latest pricing file" is a scoped recency request: if the query names a
    # folder but no filename, modification time is the intended discriminator.
    if wants_latest:
        folder_matches = [item for item in ranked if item[2] > 0]
        strong_name_matches = [item for item in folder_matches if item[1] > 0 or item[0] >= 78]
        if folder_matches and not strong_name_matches:
            return str(max(folder_matches, key=lambda item: item[3])[4])

    ranked.sort(key=lambda item: (item[0], item[3]), reverse=True)
    best = ranked[0]
    runner_up = ranked[1] if len(ranked) > 1 else None

    # Accept a strong fuzzy filename, an exact meaningful filename token, or
    # a name+folder combination. Otherwise refuse to guess.
    confident = best[0] >= 78 or best[1] >= 1 and best[0] >= 65 or best[1] >= 1 and best[2] >= 1
    if not confident:
        return None

    # Close scores with no exact token evidence are ambiguous. This prevents a
    # fuzzy STT fragment from silently choosing a neighboring note.
    if runner_up and best[1] == 0 and best[0] - runner_up[0] < 4:
        return None

    return str(best[4])
