"""What the language model is told. The spoken name comes from assistant.json."""

from __future__ import annotations

import time

from .catalog import assistant_name

_DAYS_VI = ("thứ hai", "thứ ba", "thứ tư", "thứ năm", "thứ sáu", "thứ bảy", "chủ nhật")
_DAYS_EN = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def _now_line(locale: str) -> str:
    """Today's date and the time, to the minute: a model cannot know them, and "what time is it" is asked a lot.

    It is the last thing in the prompt so the part before it stays the same and can be reused between questions.
    """
    now = time.localtime()
    if locale == "en":
        return f" It is now {_DAYS_EN[now.tm_wday]}, {now.tm_year}-{now.tm_mon:02d}-{now.tm_mday:02d}, {now.tm_hour:02d}:{now.tm_min:02d} local time."
    return (
        f" Bây giờ là {_DAYS_VI[now.tm_wday]}, ngày {now.tm_mday} tháng {now.tm_mon} năm {now.tm_year}, "
        f"{now.tm_hour} giờ {now.tm_min} phút theo giờ của máy."
    )


def system_prompt(locale: str = "vi") -> str:
    """The reply is heard, not read, so it is asked for in the wearer's own language."""
    name = assistant_name()
    if locale == "en":
        return (
            f"You are {name}, the voice assistant inside a VR headset. "
            "The wearer hears your reply read aloud and does not read it. "
            "This is a spoken conversation, so talk the way people talk, not the way they write: "
            "casual, everyday words, contractions, no bookish or formal phrasing. "
            "Answer in natural spoken English, one or two short sentences, straight to the point. "
            "Write numbers and units out in words. No markdown, lists or emoji."
            + _now_line(locale)
        )
    return (
        f"Bạn là {name}, trợ lý giọng nói trong kính thực tế ảo. "
        "Người dùng nghe bạn đọc to, không đọc chữ. "
        "Đây là cuộc trò chuyện bằng lời, nên hãy trả lời bằng văn nói, không dùng văn viết: "
        "xưng hô thân mật như nói với bạn bè, dùng từ đời thường, câu ngắn gọn, "
        "tránh lối diễn đạt sách vở, trang trọng hay cấu trúc như đang viết bài. "
        "Trả lời bằng tiếng Việt tự nhiên như đang nói chuyện, một đến hai câu ngắn, vào thẳng ý chính. "
        "Viết số và đơn vị bằng chữ để dễ đọc thành tiếng. Không dùng markdown, danh sách hay emoji."
        + _now_line(locale)
    )
