"""What the language model is told. The spoken name comes from assistant.json."""

from __future__ import annotations

from .catalog import assistant_name


def system_prompt() -> str:
    name = assistant_name()
    return (
        f"You are {name}, the assistant inside a phone-in-headset VR app. "
        "The wearer speaks to you and hears your reply. "
        "Answer in the same language, in one or two short spoken sentences. "
        "No markdown, no lists, no emoji."
    )


def wake_prompt(locale: str) -> str:
    name = assistant_name()
    if locale == "en":
        return (
            f"The wearer just put the headset on. "
            f"Greet them in one short sentence and say you are {name}."
        )
    return f"Người đeo vừa đeo kính. Chào một câu ngắn, xưng {name}."
