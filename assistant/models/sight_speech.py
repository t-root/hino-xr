"""Asking the headset to look: "tôi đang thấy gì?" (describe the scene), "đọc mã" (read the QR code or barcode),
and, with a model that reads pictures, "cái này là gì?" (ask), "đọc chữ này" (read) and "dịch cái này" (translate).

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

# Said about the writing in front of the camera: read it out loud.
_READ = (
    re.compile(r"\bdoc\b.*\b(?:chu|van ban|bien bao|bien|bang hieu|thuc don|menu|nhan|dong chu|tam bien|bang)\b"),
    re.compile(r"\b(?:tren|o) (?:bien|bang|nhan|tam|giay|trang|day|do|kia)\b.*\b(?:ghi|viet|noi)\b.*\bgi\b"),
    re.compile(r"\b(?:chu|dong chu|van ban|bien bao|thuc don) (?:nay|kia|do|o day)\b.*\bgi\b"),
    re.compile(r"\bread\b.*\b(?:text|sign|menu|label|writing|words|this page|this|that)\b"),
    re.compile(r"\bwhat (?:does|do) (?:this|that|it|the sign|the menu|these|those)\b.*\b(?:say|read|write|mean)\b"),
    re.compile(r"\bwhat(?:.s| is) written\b"),
)

# Said about the writing in front of the camera: put it into the wearer's language.
_TRANSLATE = (
    re.compile(r"\bdich\b(?: giup| cho)?(?: toi| minh)? (?:(?:cai|tam|dong|doan|cau) )?(?:nay|kia|chu|van ban|bien|menu|thuc don|nhan|o day|tren day)\b"),
    re.compile(r"\btranslate\b.*\b(?:this|that|sign|menu|text|it|these|what)\b"),
)

# Said about one thing held up to the camera: what is it.
_ASK = (
    re.compile(r"\b(?:cai|con|loai|vat|thu|cay|hoa|mon|do) (?:nay|kia|do) la (?:cai |con |loai |vat |thu |cay |hoa |mon )?gi\b"),
    re.compile(r"\bday la (?:cai |con |loai |vat |thu |cay |hoa |mon |nguoi )?(?:gi|the nao)\b"),
    re.compile(r"\b(?:nhin|xem)(?: giup| cho)?(?: toi| minh)? (?:cai |hinh |anh |vat |thu )?(?:nay|kia)\b"),
    re.compile(r"\bwhat (?:is|s|are) (?:this|that|these|those)\b"),
    re.compile(r"\bwhat kind of\b.*\b(?:is this|is that|am i holding|is it)\b"),
    re.compile(r"\b(?:look at|check out) (?:this|that)\b"),
)

_ACK = {"vi": "Để mình xem.", "en": "Let me look."}

_MISSING = {
    "scene": {
        "vi": "Hãy bật tiện ích Mô tả cảnh trước, rồi hỏi lại.",
        "en": "Turn on the Scene description plugin first, then ask again.",
    },
    "code": {
        "vi": "Hãy bật tiện ích Đọc mã trước, rồi đưa mã vào khung hình.",
        "en": "Turn on the Code reader plugin first, then hold the code in view.",
    },
    "look": {
        "vi": "Hãy bật tiện ích Hỏi về hình ảnh trước, rồi hỏi lại.",
        "en": "Turn on the Ask about what you see plugin first, then ask again.",
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
    elif any(pattern.search(folded) for pattern in _TRANSLATE):
        what = "translate"
    elif any(pattern.search(folded) for pattern in _READ):
        what = "read"
    elif any(pattern.search(folded) for pattern in _SCENE):
        what = "scene"
    elif any(pattern.search(folded) for pattern in _ASK):
        what = "ask"
    else:
        return None
    language = "en" if locale == "en" else "vi"
    value: dict[str, Any] = {"what": what, "missing": _MISSING["look" if what in {"ask", "read", "translate"} else what][language]}
    if what in {"ask", "read", "translate"}:
        # The picture model is asked in the wearer's words; read and translate need no more than their kind.
        value.update(question=heard.strip()[:400], locale="en" if locale == "en" else "vi")
    # The picture model can take a while: say at once that the question was heard.
    reply = _ACK[language] if what in {"ask", "read", "translate"} else ""
    return {"action": "sight", "id": None, "description": "", "value": value, "reply": reply}
