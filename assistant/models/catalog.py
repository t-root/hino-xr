"""What the assistant is called, says first, and which voice it speaks with. Which AI answers is `ai/stages.json`."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from ai.config import env as _env, path_of

_REPO = Path(__file__).resolve().parents[2]
_DEFAULT_VOICE_VI = "assistant/weights/vieneu"
_VOICE_REFERENCE = "assistant/voices/hino.wav"
CORE_ID = "assistant"
# The id the page saved when the assistant was a 3B Qwen on this machine: still accepted, it means the same assistant.
LEGACY_IDS = {"qwen-2.5-3b"}


@dataclass(frozen=True)
class ModelSpec:
    """The assistant the page talks to. Which models answer for it is the stages in `ai/stages.json`."""

    id: str


def catalog() -> tuple[ModelSpec, ...]:
    return (ModelSpec(id=CORE_ID),)


def get_spec(model_id: str) -> ModelSpec | None:
    if model_id in LEGACY_IDS:
        model_id = CORE_ID
    return next((spec for spec in catalog() if spec.id == model_id), None)


def voice_vi_dir() -> Path:
    """Folder of the Vietnamese voice model: turbo/ (VieNeu Turbo, ONNX) and codec/ (audio codec)."""
    return path_of(_env("VR_VOICE_VI_PATH") or _DEFAULT_VOICE_VI)


def voice_reference() -> Path:
    """A few seconds of the assistant's own voice; the Vietnamese voice is cloned from it. Part of the repository."""
    return _REPO / _VOICE_REFERENCE


def assistant_line(key: str, locale: str) -> str:
    """A line the assistant says by default, from src/shared/assistant.json (`greeting`, `ack`, `looking`)."""
    path = _REPO / "src" / "shared" / "assistant.json"
    lines = json.loads(path.read_text(encoding="utf-8")).get(key) or {}
    text = lines.get("vi" if locale == "vi" else "en")
    return text.strip() if isinstance(text, str) else ""


def line_of(lines: dict[str, str] | None, key: str, locale: str) -> str:
    """The wearer's own line for `key` when the page sent one (empty means say nothing), else the default."""
    if lines is not None and key in lines:
        return lines[key].strip()
    return assistant_line(key, locale)


def assistant_greeting(locale: str) -> str:
    """The first line spoken when the system comes up. Default: src/shared/assistant.json."""
    return assistant_line("greeting", locale)


def assistant_name() -> str:
    """Spoken name. One file, shared with the web: src/shared/assistant.json."""
    path = _REPO / "src" / "shared" / "assistant.json"
    name = json.loads(path.read_text(encoding="utf-8")).get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("assistant.json is missing a name")
    return name.strip()
