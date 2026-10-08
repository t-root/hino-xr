"""GGUF slots for llama.cpp.

Core's assistant is a file on disk. A plugin that needs its own GGUF adds a
`slots` entry to its `models.json`; this file never names that plugin.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ModelSpec:
    """One loadable GGUF file."""

    id: str
    gguf: str

    def path(self) -> Path:
        raw = Path(self.gguf)
        return raw if raw.is_absolute() else _REPO / raw

    @property
    def source(self) -> str:
        return str(self.path())


def _env(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def _load_env() -> None:
    """Read VR_* from assistant/.env or the repo .env. Ignore leftover VITE_ keys."""
    root = Path(__file__).resolve().parents[1]
    for path in (root / ".env", root.parent / ".env"):
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, _, value = stripped.partition("=")
            key = key.strip()
            if not key or key.startswith("VITE_"):
                continue
            os.environ.setdefault(key, value.strip().strip('"').strip("'"))


_load_env()

_REPO = Path(__file__).resolve().parents[2]
_DEFAULT_GGUF = "assistant/weights/qwen2.5-3b-instruct-q4_k_m.gguf"
_DEFAULT_WHISPER = "assistant/weights/ggml-small.bin"
_DEFAULT_VOICE_VI = "assistant/weights/vits-piper-vi_VN-vais1000-medium"


def catalog() -> tuple[ModelSpec, ...]:
    core = ModelSpec(
        id="qwen-2.5-3b",
        gguf=_env("VR_MODEL_PATH") or _DEFAULT_GGUF,
    )
    extras = _plugin_slots()
    seen = {core.id}
    for spec in extras:
        if spec.id in seen:
            raise ValueError(f"duplicate model slot id {spec.id}")
        seen.add(spec.id)
    return (core, *extras)


def _plugin_slots() -> tuple[ModelSpec, ...]:
    modules = _REPO / "src" / "modules"
    if not modules.is_dir():
        return ()
    specs: list[ModelSpec] = []
    for folder in sorted(path for path in modules.iterdir() if path.is_dir()):
        declared = folder / "models.json"
        if not declared.is_file():
            continue
        data = json.loads(declared.read_text(encoding="utf-8"))
        for slot in data.get("slots") or []:
            if (slot.get("kind") or "causal-lm") != "causal-lm":
                continue
            slot_id = slot["id"]
            env_key = f"VR_MODEL_PATH_{slot_id.replace('-', '_').upper()}"
            specs.append(
                ModelSpec(
                    id=slot_id,
                    # Relative to the plugin's own folder: its weights live there.
                    gguf=_env(env_key) or str(folder / slot["gguf"]),
                )
            )
    return tuple(specs)


def get_spec(model_id: str) -> ModelSpec | None:
    for spec in catalog():
        if spec.id == model_id:
            return spec
    return None


def whisper_path() -> Path:
    raw = _env("VR_WHISPER_PATH") or _DEFAULT_WHISPER
    path = Path(raw)
    return path if path.is_absolute() else _REPO / path


def voice_vi_dir() -> Path:
    """Folder of the Vietnamese Piper voice (.onnx, tokens.txt, espeak-ng-data)."""
    raw = _env("VR_VOICE_VI_PATH") or _DEFAULT_VOICE_VI
    path = Path(raw)
    return path if path.is_absolute() else _REPO / path


def assistant_greeting(locale: str) -> str:
    """The first line spoken when the system comes up. Default: src/shared/assistant.json."""
    path = _REPO / "src" / "shared" / "assistant.json"
    greeting = json.loads(path.read_text(encoding="utf-8")).get("greeting") or {}
    text = greeting.get("vi" if locale == "vi" else "en")
    return text.strip() if isinstance(text, str) else ""


def assistant_name() -> str:
    """Spoken name. One file, shared with the web: src/shared/assistant.json."""
    path = _REPO / "src" / "shared" / "assistant.json"
    name = json.loads(path.read_text(encoding="utf-8")).get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError("assistant.json is missing a name")
    return name.strip()
