
from __future__ import annotations

import re
from typing import Any

from .catalog import line_of
from .sight_speech import _fold

_SCREEN = (
    re.compile(r"\b(?:tren|trong|o) (?:man hinh|giao dien|trang)\b.*\b(?:co|ghi|viet|hien|bao|noi|la)\b"),
    re.compile(r"\b(?:man hinh|giao dien)\b.*\b(?:bi gi|co gi|ghi gi|viet gi|hien gi|sao|the nao|loi|dang bao|dang hien)\b"),
    re.compile(r"\b(?:doc|xem|nhin|chup|phan tich|kiem tra)\b.*\b(?:man hinh|giao dien)\b"),
    re.compile(r"\bwhat(?:.s| is| does)\b.*\b(?:on|says?)\b.*\b(?:the |my |this )?screen\b"),
    re.compile(r"\b(?:read|look at|check|analy[sz]e|describe|screenshot)\b.*\b(?:the |my |this )?screen\b"),
)

_ERROR = (
    re.compile(r"\b(?:doc|xem|giai thich|phan tich|kiem tra)\b.*\b(?:loi|bug|nhat ky|log|canh bao)\b"),
    re.compile(r"\b(?:loi|bug|canh bao)\b.*\b(?:nay|kia|do|day)\b.*\b(?:la gi|nghia la gi|do dau|tai sao|sao)\b"),
    re.compile(r"\b(?:loi|bug) (?:gi|nao) (?:vay|day|the)\b"),
    re.compile(r"\bwhat(?:.s| is| does)\b.*\b(?:this |that |the )?(?:error|bug|warning|log)\b"),
    re.compile(r"\b(?:read|explain|analy[sz]e|check)\b.*\b(?:the |this |that )?(?:error|bug|warning|log)\b"),
)

_READ = (
    re.compile(r"\bdoc\b.*\b(?:chu|van ban|bien bao|bien|bang hieu|thuc don|menu|nhan|dong chu|tam bien|bang)\b"),
    re.compile(r"\b(?:tren|o) (?:bien|bang|nhan|tam|giay|trang|day|do|kia)\b.*\b(?:ghi|viet|noi)\b.*\bgi\b"),
    re.compile(r"\b(?:chu|dong chu|van ban|bien bao|thuc don) (?:nay|kia|do|o day)\b.*\bgi\b"),
    re.compile(r"\bread\b.*\b(?:text|sign|menu|label|writing|words|this page|this|that)\b"),
    re.compile(r"\bwhat (?:does|do) (?:this|that|it|the sign|the menu|these|those)\b.*\b(?:say|read|write|mean)\b"),
    re.compile(r"\bwhat(?:.s| is) written\b"),
)

_TRANSLATE = (
    re.compile(r"\bdich\b(?: giup| cho)?(?: toi| minh)? (?:(?:cai|tam|dong|doan|cau) )?(?:nay|kia|chu|van ban|bien|menu|thuc don|nhan|o day|tren day)\b"),
    re.compile(r"\btranslate\b.*\b(?:this|that|sign|menu|text|it|these|what)\b"),
)

_ASK = (
    re.compile(r"\b(?:cai|con|loai|vat|thu|cay|hoa|mon|do) (?:nay|kia|do) la (?:cai |con |loai |vat |thu |cay |hoa |mon )?gi\b"),
    re.compile(r"\bday la (?:cai |con |loai |vat |thu |cay |hoa |mon |nguoi )?(?:gi|the nao)\b"),
    re.compile(r"\b(?:nhin|xem)(?: giup| cho)?(?: toi| minh)? (?:cai |hinh |anh |vat |thu )?(?:nay|kia)\b"),
    re.compile(r"\bwhat (?:is|s|are) (?:this|that|these|those)\b"),
    re.compile(r"\bwhat kind of\b.*\b(?:is this|is that|am i holding|is it)\b"),
    re.compile(r"\b(?:look at|check out) (?:this|that)\b"),
)


def screen_command(heard: str, locale: str, lines: dict[str, str] | None = None) -> dict[str, Any] | None:
    folded = _fold(heard)
    if not folded or not any(pattern.search(folded) for pattern in (*_SCREEN, *_ERROR, *_READ, *_TRANSLATE, *_ASK)):
        return None
    language = "en" if locale == "en" else "vi"
    value = {"question": heard.strip()[:400], "locale": language, "failed": line_of(lines, "failed", language)}
    return {"action": "screen", "id": None, "description": "", "value": value, "reply": line_of(lines, "looking", language)}
