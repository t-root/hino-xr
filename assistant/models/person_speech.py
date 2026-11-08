"""Saving a person by voice: "lưu người này, tên là Nam, sinh năm 1990, thông tin: bạn đại học".

Matched on words, not by the language model (rules.md F1): it runs at once, works offline and cannot
invent a name. The line may name the person, the year of birth and a note, in any order, and may come in
pieces ("người này sinh năm 1990", a moment later "thông tin là bạn học cũ"). What was heard is handed to
the page as a `person` command; the page knows which face is in front of the camera and does the saving.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

_THIS_PERSON = re.compile(r"\b(?:nguoi nay|khuon mat nay|this person|this face|him|her)\b")
_SAVE = re.compile(
    r"\b(?:luu|ghi nho|nho|them|dang ky|save|remember|add|register|store)\b",
)

# A slot starts at its keyword and runs to the next keyword. Longer phrases come first so "thong tin" wins over "tin".
_SLOTS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("year", re.compile(r"\b(?:sinh nam|nam sinh|sinh vao nam|born in|born|year of birth|birth year)\b")),
    ("info", re.compile(r"\b(?:thong tin|ghi chu|mo ta|information|info|notes?|about)\b")),
    ("name", re.compile(r"\b(?:ten(?: la| cua| anh ay| co ay)?|name is|called|name)\b")),
)

_DIGITS = {"khong": 0, "mot": 1, "hai": 2, "ba": 3, "bon": 4, "tu": 4, "nam": 5, "lam": 5, "sau": 6, "bay": 7, "tam": 8, "chin": 9}
_SKIP = {"la"}


def _fold(text: str) -> str:
    """The text in lower case, without accents, and exactly as long: one letter stays one letter."""
    out = []
    for char in unicodedata.normalize("NFC", text):
        base = unicodedata.normalize("NFD", char)[0]
        out.append("d" if char in "đĐ" else base.lower())
    return "".join(out)


def vietnamese_year(text: str) -> int | None:
    """A year said or written: 1990, "một chín chín không", "một nghìn chín trăm chín mươi", "hai nghìn không trăm lẻ năm"."""
    digits = re.search(r"\b(1[89]\d{2}|20\d{2})\b", text)
    if digits:
        return int(digits.group(1))
    words = _fold(text).replace(",", " ").split()
    if not words:
        return None
    # Four digits read one by one.
    if len(words) == 4 and all(word in _DIGITS for word in words):
        return int("".join(str(_DIGITS[word]) for word in words))
    return _composed(words)


def _composed(words: list[str]) -> int | None:
    total = 0
    pending: int | None = None
    seen = False
    for word in words:
        if word in ("nghin", "ngan"):
            total += (pending if pending is not None else 1) * 1000
            pending, seen = None, True
        elif word == "tram":
            total += (pending if pending is not None else 1) * 100
            pending, seen = None, True
        elif word in ("muoi", "chuc"):
            total += (pending if pending is not None else 1) * 10
            pending, seen = None, True
        elif word in ("linh", "le"):
            continue
        elif word in _DIGITS:
            pending, seen = _DIGITS[word], True
        elif word in _SKIP:
            continue
        else:
            return None
    if pending is not None:
        total += pending
    return total if seen and 1900 <= total <= 2100 else None


_LEADING = re.compile(r"^(?:[\s,.:;-]+|(?:la|is|are|of|nguoi nay|khuon mat nay|this person|this face)(?![a-z]))+")


def _clean(value: str) -> str:
    """The value without the words that only join it to its keyword: "là", "người này", a colon."""
    folded = _fold(value)
    match = _LEADING.match(folded)
    start = match.end() if match else 0
    return value[start:].strip(" ,.;:!?\"'-").strip()


def _capitalise(name: str) -> str:
    return " ".join(word[:1].upper() + word[1:] if word.islower() else word for word in name.split())


def person_command(heard: str, locale: str) -> dict[str, Any] | None:
    """What the wearer said about the person in front of the camera, or None when it was not about that."""
    del locale  # Both languages are understood whichever the page is in.
    folded = _fold(heard)
    found: list[tuple[int, int, str]] = []
    for slot, pattern in _SLOTS:
        match = pattern.search(folded)
        if match:
            found.append((match.start(), match.end(), slot))
    about_person = _THIS_PERSON.search(folded) is not None
    save = _SAVE.search(folded) is not None
    if not found and not (about_person and save):
        return None
    if not about_person and not (save and found):
        # "tên" and "thông tin" are common words: only a line that says whose, or says to save, is for the headset.
        return None
    found.sort()
    fields: dict[str, Any] = {}
    for index, (_, end, slot) in enumerate(found):
        stop = found[index + 1][0] if index + 1 < len(found) else len(heard)
        value = _clean(heard[end:stop])
        if slot == "name" and value:
            fields["name"] = _capitalise(value)
        elif slot == "year":
            year = vietnamese_year(value)
            if year is not None:
                fields["year"] = year
        elif slot == "info" and value:
            fields["info"] = value
    return {
        "action": "person",
        "id": None,
        "description": "",
        "value": {"save": save, **fields},
        "reply": "",
    }
