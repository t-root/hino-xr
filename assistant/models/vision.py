"""The assistant looking at what the wearer sees (the interface over the camera picture), to answer a question asked with a chat line.

It is the `vision` stage of `ai/stages.json`: a model that reads pictures (llama.cpp with Qwen3-VL here), which is the same
model as the answers unless `VR_VISION_URL` points it elsewhere. A plugin has no use of it: a plugin that needs a model asks
the `plugin_chat` stage (`/api/plugin-ai/chat`).
"""

from __future__ import annotations

import ai
from .tools import _sentences

MAX_IMAGE = 3_000_000
SPOKEN_CHARS = 190  # what is read aloud: `/api/voice/preview` takes 200
SHOWN_CHARS = 1600
TOKENS = 400


class VisionError(Exception):
    """Nothing could answer; the text is for the log, the page says its own line."""


def prompt(question: str, locale: str) -> str:
    """What the picture model is told. It answers in the wearer's language."""
    language = "Vietnamese" if locale == "vi" else "English"
    return (
        "This is what the person sees in an AR headset: the app's interface (menus, logs, text) drawn over the picture from the camera "
        "in front of them. Answer their question about whatever it is about, the interface or the thing in the camera picture; "
        "if it shows an error or a log, say what the error is and the likely cause. If they ask for the text, read it as written; "
        "if they ask to translate it, translate it. "
        f"Answer in {language}, in plain spoken words with no markdown or emoji, in at most five short sentences. "
        f"If you cannot tell from the picture, say so. Question: {question.strip()[:400] or 'What is on the screen?'}"
    )


def ask_screen(image: bytes, question: str, locale: str) -> dict[str, str]:
    """The answer to a picture of the screen: `say` is short enough to be read aloud, `show` is all of it for the screen."""
    try:
        answer = ai.see("vision", image, prompt(question, locale), TOKENS)
    except ai.AIError as error:
        raise VisionError(str(error)) from error
    if not answer:
        raise VisionError("the model answered nothing")
    return {"say": _sentences(" ".join(answer.split()), SPOKEN_CHARS), "show": answer[:SHOWN_CHARS]}
