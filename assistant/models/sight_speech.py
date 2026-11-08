"""Asking the headset to look: "tôi đang thấy gì?" (describe the scene) and "đọc mã" (read the QR code or barcode).

Matched on words, not by the language model (rules.md F1): it runs at once, works offline and cannot make up
what is in front of the camera. The answer comes from a plugin on the page (`scene-description`, `code-reader`),
which is the only part that has the camera frames; this only works out which look was asked for. When that plugin
is off the page says `missing`, written here in the language of the page.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

# Said about the scene: what do I see / what is in front of me / what is around me.
_SCENE = (
    re.compile(r"\b(?:toi|minh|tui|ban|hino)(?: dang)? (?:thay|nhin thay|nhin)(?: duoc)?(?: nhung)? (?:gi|cai gi)\b"),
    re.compile(r"\b(?:truoc mat|xung quanh|quanh day|trong khung hinh|trong phong)(?: toi| minh)? co (?:gi|nhung gi|cai gi)\b"),
    re.compile(r"\b(?:mo ta|ta lai|tuong thuat)\b.*\b(?:canh|khung canh|xung quanh|truoc mat|nhung gi)\b"),
    re.compile(r"\bwhat\b.*\b(?:do i see|can i see|am i looking at|is in front of me|is around me|do you see)\b"),
    re.compile(r"\bdescribe\b.*\b(?:scene|surroundings|what you see|what i see|around me|in front)\b"),
    re.compile(r"\b(?:what.s|what is) (?:in front of me|around me)\b"),
)

# Said about a code: read the code / scan the QR / what does this barcode say.
_CODE = (
    re.compile(r"\b(?:doc|quet|giai ma|scan|read|decode)\b.*\b(?:ma qr|ma vach|qr|barcode|bar code|the code|this code)\b"),
    re.compile(r"\b(?:doc|quet)(?: giup| cho)?(?: toi| minh)? (?:cai |the )?ma(?: nay| qr| vach| di| giup| cho| lai| toi)*$"),
    re.compile(r"\b(?:qr|barcode|bar code|ma qr|ma vach)\b.*\b(?:noi|viet|chua|say|says|contain|contains|la gi)\b"),
    re.compile(r"\bma (?:nay|qr|vach)\b.*\b(?:noi|viet|chua)\b.*\bgi\b"),
)

_MISSING = {
    "scene": {
        "vi": "Hãy bật tiện ích Mô tả cảnh trước, rồi hỏi lại.",
        "en": "Turn on the Scene description plugin first, then ask again.",
    },
    "code": {
        "vi": "Hãy bật tiện ích Đọc mã trước, rồi đưa mã vào khung hình.",
        "en": "Turn on the Code reader plugin first, then hold the code in view.",
    },
}


def _fold(text: str) -> str:
    """Lower case, no accents, and "đ" as "d"; punctuation becomes a space."""
    out = []
    for char in unicodedata.normalize("NFC", text):
        base = unicodedata.normalize("NFD", char)[0]
        out.append("d" if char in "đĐ" else base.lower())
    return re.sub(r"[^a-z0-9']+", " ", "".join(out)).strip()


def sight_command(heard: str, locale: str) -> dict[str, Any] | None:
    """Which look was asked for, or None when the line was not about looking."""
    folded = _fold(heard)
    if not folded:
        return None
    # A code is checked first: "đọc mã" must not be taken for a question about the scene ("đọc ra").
    if any(pattern.search(folded) for pattern in _CODE):
        what = "code"
    elif any(pattern.search(folded) for pattern in _SCENE):
        what = "scene"
    else:
        return None
    language = "en" if locale == "en" else "vi"
    return {
        "action": "sight",
        "id": None,
        "description": "",
        "value": {"what": what, "missing": _MISSING[what][language]},
        "reply": "",
    }
