"""Asking the assistant to look at what the wearer sees: "đọc lỗi trên màn hình", "cái này là gì", "dịch cái này", "what is this".

Matched on words (rules.md F1). The answer is not a plugin's: the page takes one picture of what the wearer sees, its interface
over the camera picture, and sends it with the line to `/api/assistant/screen` (`vision.ask_screen`). This only works out that
the wearer asked about it, and says at once that the question was heard, because the picture model can take a while.

What the camera sees without being asked (the scene, a QR code) is the plugins' (`sight_speech.py`), and is checked first.
"""

from __future__ import annotations

import re
from typing import Any

from .sight_speech import _fold

# Said about the screen itself.
_SCREEN = (
    re.compile(r"\b(?:tren|trong|o) (?:man hinh|giao dien|trang)\b.*\b(?:co|ghi|viet|hien|bao|noi|la)\b"),
    re.compile(r"\b(?:man hinh|giao dien)\b.*\b(?:bi gi|co gi|ghi gi|viet gi|hien gi|sao|the nao|loi|dang bao|dang hien)\b"),
    re.compile(r"\b(?:doc|xem|nhin|chup|phan tich|kiem tra)\b.*\b(?:man hinh|giao dien)\b"),
    re.compile(r"\bwhat(?:.s| is| does)\b.*\b(?:on|says?)\b.*\b(?:the |my |this )?screen\b"),
    re.compile(r"\b(?:read|look at|check|analy[sz]e|describe|screenshot)\b.*\b(?:the |my |this )?screen\b"),
)

# Said about an error or a log: the only place one is on the headset is the screen.
_ERROR = (
    re.compile(r"\b(?:doc|xem|giai thich|phan tich|kiem tra)\b.*\b(?:loi|bug|nhat ky|log|canh bao)\b"),
    re.compile(r"\b(?:loi|bug|canh bao)\b.*\b(?:nay|kia|do|day)\b.*\b(?:la gi|nghia la gi|do dau|tai sao|sao)\b"),
    re.compile(r"\b(?:loi|bug) (?:gi|nao) (?:vay|day|the)\b"),
    re.compile(r"\bwhat(?:.s| is| does)\b.*\b(?:this |that |the )?(?:error|bug|warning|log)\b"),
    re.compile(r"\b(?:read|explain|analy[sz]e|check)\b.*\b(?:the |this |that )?(?:error|bug|warning|log)\b"),
)

# Said about writing in view: read it out loud.
_READ = (
    re.compile(r"\bdoc\b.*\b(?:chu|van ban|bien bao|bien|bang hieu|thuc don|menu|nhan|dong chu|tam bien|bang)\b"),
    re.compile(r"\b(?:tren|o) (?:bien|bang|nhan|tam|giay|trang|day|do|kia)\b.*\b(?:ghi|viet|noi)\b.*\bgi\b"),
    re.compile(r"\b(?:chu|dong chu|van ban|bien bao|thuc don) (?:nay|kia|do|o day)\b.*\bgi\b"),
    re.compile(r"\bread\b.*\b(?:text|sign|menu|label|writing|words|this page|this|that)\b"),
    re.compile(r"\bwhat (?:does|do) (?:this|that|it|the sign|the menu|these|those)\b.*\b(?:say|read|write|mean)\b"),
    re.compile(r"\bwhat(?:.s| is) written\b"),
)

# Said about writing in view: put it into the wearer's language.
_TRANSLATE = (
    re.compile(r"\bdich\b(?: giup| cho)?(?: toi| minh)? (?:(?:cai|tam|dong|doan|cau) )?(?:nay|kia|chu|van ban|bien|menu|thuc don|nhan|o day|tren day)\b"),
    re.compile(r"\btranslate\b.*\b(?:this|that|sign|menu|text|it|these|what)\b"),
)

# Said about one thing in view, held up to the camera: what is it.
_ASK = (
    re.compile(r"\b(?:cai|con|loai|vat|thu|cay|hoa|mon|do) (?:nay|kia|do) la (?:cai |con |loai |vat |thu |cay |hoa |mon )?gi\b"),
    re.compile(r"\bday la (?:cai |con |loai |vat |thu |cay |hoa |mon |nguoi )?(?:gi|the nao)\b"),
    re.compile(r"\b(?:nhin|xem)(?: giup| cho)?(?: toi| minh)? (?:cai |hinh |anh |vat |thu )?(?:nay|kia)\b"),
    re.compile(r"\bwhat (?:is|s|are) (?:this|that|these|those)\b"),
    re.compile(r"\bwhat kind of\b.*\b(?:is this|is that|am i holding|is it)\b"),
    re.compile(r"\b(?:look at|check out) (?:this|that)\b"),
)


_ACK = {"vi": "Để mình xem.", "en": "Let me look."}
_FAILED = {
    "vi": "Mình chưa chụp được hình, bạn thử lại nhé.",
    "en": "I could not take the picture. Please try again.",
}


def screen_command(heard: str, locale: str) -> dict[str, Any] | None:
    """The command for a question about the screen, or None when the line was about something else."""
    folded = _fold(heard)
    if not folded or not any(pattern.search(folded) for pattern in (*_SCREEN, *_ERROR, *_READ, *_TRANSLATE, *_ASK)):
        return None
    language = "en" if locale == "en" else "vi"
    value = {"question": heard.strip()[:400], "locale": language, "failed": _FAILED[language]}
    return {"action": "screen", "id": None, "description": "", "value": value, "reply": _ACK[language]}
