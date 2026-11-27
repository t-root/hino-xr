
from __future__ import annotations

import re
import unicodedata
from typing import Any

from .catalog import line_of

_SCENE = (
    re.compile(r"\b(?:toi|minh|tui|ban|hino)(?: dang)? (?:thay|nhin thay|nhin)(?: duoc)?(?: nhung)? (?:gi|cai gi)\b"),
    re.compile(r"\b(?:truoc mat|xung quanh|quanh day|trong khung hinh|trong phong)(?: toi| minh)? co (?:gi|nhung gi|cai gi)\b"),
    re.compile(r"\b(?:mo ta|ta lai|tuong thuat)\b.*\b(?:canh|khung canh|xung quanh|truoc mat|nhung gi)\b"),
    re.compile(r"\bwhat\b.*\b(?:do i see|can i see|am i looking at|is in front of me|is around me|do you see)\b"),
    re.compile(r"\bdescribe\b.*\b(?:scene|surroundings|what you see|what i see|around me|in front)\b"),
    re.compile(r"\b(?:what.s|what is) (?:in front of me|around me)\b"),
)

_CODE = (
    re.compile(r"\b(?:doc|quet|giai ma|scan|read|decode)\b.*\b(?:ma qr|ma vach|qr|barcode|bar code|the code|this code)\b"),
    re.compile(r"\b(?:doc|quet)(?: giup| cho)?(?: toi| minh)? (?:cai |the )?ma(?: nay| qr| vach| di| giup| cho| lai| toi)*$"),
    re.compile(r"\b(?:qr|barcode|bar code|ma qr|ma vach)\b.*\b(?:noi|viet|chua|say|says|contain|contains|la gi)\b"),
    re.compile(r"\bma (?:nay|qr|vach)\b.*\b(?:noi|viet|chua)\b.*\bgi\b"),
)

_MISSING_KEY = {"scene": "noScene", "code": "noCode"}


def _fold(text: str) -> str:
    out = []
    for char in unicodedata.normalize("NFC", text):
        base = unicodedata.normalize("NFD", char)[0]
        out.append("d" if char in "đĐ" else base.lower())
    return re.sub(r"[^a-z0-9']+", " ", "".join(out)).strip()


def sight_command(heard: str, locale: str, lines: dict[str, str] | None = None) -> dict[str, Any] | None:
    folded = _fold(heard)
    if not folded:
        return None
    if any(pattern.search(folded) for pattern in _CODE):
        what = "code"
    elif any(pattern.search(folded) for pattern in _SCENE):
        what = "scene"
    else:
        return None
    language = "en" if locale == "en" else "vi"
    return {"action": "sight", "id": None, "description": "", "value": {"what": what, "missing": line_of(lines, _MISSING_KEY[what], language)}, "reply": ""}
