
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


_STOP_LINES = {
    "dunglai", "dung", "imdi", "imlang", "thoi", "thoidi", "duroi", "dungnoinua", "stop", "stopit", "stoptalking", "bequiet",
    "quiet", "shutup", "enough", "thatsenough", "hush",
}


def is_stop(heard: str, name: str) -> bool:
    return letters(drop_leading_phrase(heard, name)) in _STOP_LINES


def letters(text: str) -> str:
    plain = unicodedata.normalize("NFD", text.replace("đ", "d").replace("Đ", "D"))
    plain = "".join(char for char in plain if unicodedata.category(char) != "Mn")
    return re.sub(r"[^a-z0-9]", "", plain.lower())


_MADE_UP = (
    "subscribe",
    "dangkykenh",
    "ghienmigo",
    "thanksforwatching",
    "thankyouforwatching",
    "camondaxem",
    "camoncacbandatheodoi",
    "henganlaicacban",
    "hengaplaicacban",
    "likeandshare",
    "amaraorg",
)


def is_made_up(text: str) -> bool:
    plain = letters(text)
    return any(phrase in plain for phrase in _MADE_UP) or (not plain and bool(text.strip()))


def find_phrase(heard: str, phrase: str, threshold: float | None = None) -> tuple[bool, list[str]]:
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
    if words and letters(words[0]) in {"oi", "oy"}:
        return words[1:]
    return words


def drop_leading_phrase(heard: str, phrase: str) -> str:
    words = heard.replace("-", " ").split()
    head = words[:4]
    found, rest = find_phrase(" ".join(head), phrase)
    if not found:
        return heard.strip()
    return " ".join([*question_after(rest), *words[4:]]).strip(" ,.!?")
