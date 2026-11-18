"""Looking at one picture and answering: a question about it, the text on it, or that text translated.

The headset's page sends a still from the camera with what was asked (`ask`, `read` or `translate`); a model that
reads pictures answers. Like every other stage it has two places to run, chosen by `VR_VISION_SOURCE`:

- `local`: Qwen2.5-VL 3B through llama.cpp, on this computer (`VR_VISION_MODEL_PATH`, `VR_VISION_MMPROJ_PATH`).
  The files are fetched by `run.py` only when `VR_VISION_SOURCE=local` is set, because they weigh almost 3 GB.
  Slow on a CPU: expect tens of seconds a picture.
- `api`: a SiliconFlow model that reads pictures (`VR_VISION_MODEL`). The picture then leaves this computer.

When the API fails and the local files are there, the local model answers instead.
"""

from __future__ import annotations

import base64
import os
import threading
from pathlib import Path
from typing import Any

from . import cloud
from .catalog import _env
from .tools import _sentences

MAX_IMAGE = 3_000_000
SPOKEN_CHARS = 190  # what is read aloud: `/api/voice/preview` takes 200
SHOWN_CHARS = 1600

_REPO = Path(__file__).resolve().parents[2]
_DEFAULT_MODEL = "assistant/weights/Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf"
_DEFAULT_MMPROJ = "assistant/weights/mmproj-Qwen2.5-VL-3B-Instruct-Q8_0.gguf"
# Which of llama.cpp's picture handlers goes with the model; the default fits Qwen2.5-VL.
_HANDLERS = {
    "qwen25vl": "Qwen25VLChatHandler",
    "gemma4": "Gemma4ChatHandler",
    "moondream": "MoondreamChatHandler",
    "llava15": "Llava15ChatHandler",
    "minicpmv26": "MiniCPMv26ChatHandler",
}
_TOKENS = {"ask": 220, "read": 500, "translate": 500}


class VisionError(Exception):
    """Nothing could answer; the text is for the log, the page says its own line."""


def _path(variable: str, default: str) -> Path:
    raw = Path(_env(variable) or default)
    return raw if raw.is_absolute() else _REPO / raw


def local_files() -> tuple[Path, Path]:
    return _path("VR_VISION_MODEL_PATH", _DEFAULT_MODEL), _path("VR_VISION_MMPROJ_PATH", _DEFAULT_MMPROJ)


def local_ready() -> bool:
    return all(path.is_file() for path in local_files())


def prompt(what: str, question: str, locale: str) -> str:
    """What the picture model is told. The picture model answers in the wearer's language."""
    language = "Vietnamese" if locale == "vi" else "English"
    if what == "read":
        return (
            "Read all the text you can see in the picture, exactly as it is written and in reading order. "
            f"Output only that text. If there is no readable text, say so in {language} in one short sentence."
        )
    if what == "translate":
        return (
            f"Translate all the text you can see in the picture into {language}. Output only the translation. "
            f"If there is no readable text, say so in {language} in one short sentence."
        )
    return (
        "You are the eyes of a person wearing an AR headset. Look at the picture and answer their question. "
        f"Answer in {language}, in at most three short sentences, in plain spoken words, with no markdown, lists or emoji. "
        f"If you cannot tell from the picture, say so.\nQuestion: {question.strip()[:400] or 'What is this?'}"
    )


_lock = threading.Lock()
_session: Any = None


def _local(image: bytes, text: str, max_tokens: int) -> str:
    global _session
    model, mmproj = local_files()
    if not (model.is_file() and mmproj.is_file()):
        raise VisionError(
            f"the local picture model is not here ({model.name}, {mmproj.name}): set VR_VISION_SOURCE=local in assistant/.env "
            "and run run.py to fetch it, or set VR_VISION_SOURCE=api and VR_SILICONFLOW_KEY"
        )
    with _lock:  # one picture at a time: the session is not re-entrant
        if _session is None:
            try:
                from llama_cpp import Llama
                from llama_cpp import llama_chat_format

                handler_name = _HANDLERS.get((_env("VR_VISION_HANDLER") or "qwen25vl").lower())
                handler = getattr(llama_chat_format, handler_name or "", None)
                if handler is None:
                    raise VisionError(f"this llama.cpp has no picture handler named {_env('VR_VISION_HANDLER') or 'qwen25vl'}")
                _session = Llama(
                    model_path=str(model),
                    chat_handler=handler(clip_model_path=str(mmproj), verbose=False),
                    n_ctx=int(_env("VR_VISION_N_CTX") or "4096"),
                    n_gpu_layers=int(_env("VR_N_GPU_LAYERS") or "0"),
                    n_threads=int(_env("VR_N_THREADS") or os.cpu_count() or 4),
                    verbose=False,
                )
            except VisionError:
                raise
            except Exception as error:  # noqa: BLE001 - any load failure is the same to the wearer
                raise VisionError(f"the local picture model did not load: {error}") from error
        uri = "data:image/jpeg;base64," + base64.b64encode(image).decode("ascii")
        try:
            reply = _session.create_chat_completion(
                messages=[{"role": "user", "content": [{"type": "image_url", "image_url": {"url": uri}}, {"type": "text", "text": text}]}],
                max_tokens=max_tokens,
                temperature=0.2,
            )
            return str(reply["choices"][0]["message"]["content"] or "").strip()
        except Exception as error:  # noqa: BLE001
            raise VisionError(f"the local picture model failed: {error}") from error


def ask(image: bytes, what: str, question: str, locale: str) -> dict[str, str]:
    """The answer to one picture: `say` is short enough to be read aloud, `show` is all of it for the screen."""
    if what not in _TOKENS:
        raise VisionError(f"unknown kind of look: {what}")
    text = prompt(what, question, locale)
    answer = ""
    where = "local"
    if cloud.wants("vision"):
        try:
            answer, where = cloud.see(image, text, _TOKENS[what]), "api"
        except (cloud.CloudError, OSError) as error:
            cloud.failed("vision")
            print(f"  cloud    picture question failed, trying the local model: {error}", flush=True)
    if not answer:
        answer = _local(image, text, _TOKENS[what])
    if not answer:
        raise VisionError("the model answered nothing")
    spoken = _sentences(" ".join(answer.split()), SPOKEN_CHARS)
    return {"say": spoken, "show": answer[:SHOWN_CHARS], "source": where}
