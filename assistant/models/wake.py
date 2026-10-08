"""Spotting the spoken words that wake the system and the assistant.

The speech comes back from Whisper as text that is close to what was said but
rarely identical: "Hi-no-ỡi", "Hino is", "system call.". So the match is by
sound-alike spelling with a margin, not by equality.
"""

from __future__ import annotations

import json
import re
import unicodedata
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
from typing import Any

_WAKE_JSON = Path(__file__).resolve().parents[2] / "src" / "shared" / "wake.json"
_MAX_WORDS = 3


@lru_cache(maxsize=1)
def wake_spec() -> dict[str, Any]:
    return json.loads(_WAKE_JSON.read_text(encoding="utf-8"))


def letters(text: str) -> str:
    """Lower-case letters only, accents removed: "Hí-nô" and "hi no" both become "hino"."""
    plain = unicodedata.normalize("NFD", text.replace("đ", "d").replace("Đ", "D"))
    plain = "".join(char for char in plain if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]", "", plain.lower())


def find_phrase(heard: str, phrase: str, threshold: float | None = None) -> tuple[bool, list[str]]:
    """Whether `phrase` is in `heard`, and the words that came after it.

    Every run of up to three consecutive words is compared with the phrase, so a
    phrase Whisper split in two ("hi no") or glued ("hino") is found either way.
    """
    margin = wake_spec()["match"] if threshold is None else threshold
    target = letters(phrase)
    words = heard.replace("-", " ").split()
    best: tuple[float, int, int] | None = None
    for start in range(len(words)):
        for size in range(1, _MAX_WORDS + 1):
            if start + size > len(words):
                break
            candidate = letters("".join(words[start : start + size]))
            if len(candidate) < max(2, len(target) - 2):
                continue
            score = SequenceMatcher(None, candidate, target).ratio()
            if score >= margin and (best is None or score > best[0]):
                best = (score, start, start + size)
    if best is None:
        return False, []
    return True, words[best[2] :]


def question_after(words: list[str]) -> list[str]:
    """What follows a wake word, without the "ơi" that calls someone by name."""
    if words and letters(words[0]) in {"oi", "oy"}:
        return words[1:]
    return words


def drop_leading_phrase(heard: str, phrase: str) -> str:
    """The question without the wake word in front of it, if there is one."""
    words = heard.replace("-", " ").split()
    head = words[:4]
    found, rest = find_phrase(" ".join(head), phrase)
    if not found:
        return heard.strip()
    return " ".join([*question_after(rest), *words[4:]]).strip(" ,.!?")
