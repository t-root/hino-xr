"""Where every AI of the project runs, read from one file per profile: `stages.cpu.json` or `stages.gpu.json` (`VR_PROFILE`).

Two sides, kept apart on purpose:

- the assistant (Hino): `chat`, `agent`, `vision` (a picture of the screen), `code` (writing plugins), `stt`, `stt_wake`, `tts`;
- the plugins: `plugin_chat`. A plugin never reaches an assistant stage; it asks the
  server for a plugin stage, which has its own url, key and model and may be pointed elsewhere without touching Hino.

A stage is only a url, a key and a model. By default the url is a server of this machine (see `servers.py`). To use an
API of somebody else, set in `assistant/.env`:

    VR_<STAGE>_URL    an OpenAI-style base, e.g. https://api.example.com/v1
    VR_<STAGE>_KEY    its key
    VR_<STAGE>_MODEL  its model name

and nothing else changes: the same client, the same code, the same prompts.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import profiles

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]

ASSISTANT_STAGES = ("chat", "agent", "vision", "code", "stt", "stt_wake", "tts")
PLUGIN_STAGES = ("plugin_chat",)
KIND = {
    "chat": "chat",
    "agent": "chat",
    "vision": "chat",
    "code": "chat",
    "plugin_chat": "chat",
    "stt": "stt",
    "stt_wake": "stt",
    "tts": "tts",
}


class ConfigError(Exception):
    pass


def env(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


load_env = profiles.load_env  # reads VR_* from assistant/.env; profiles.py has it so run.py can do the same
load_env()

_spec: dict[str, Any] | None = None
_models: dict[str, str] = {}


def spec() -> dict[str, Any]:
    global _spec
    if _spec is None:
        _spec = json.loads(profiles.stages_file().read_text(encoding="utf-8"))
    return _spec


def servers() -> dict[str, dict[str, Any]]:
    return spec().get("servers", {})


def path_of(raw: str) -> Path:
    path = Path(raw)
    return path if path.is_absolute() else REPO / path


@dataclass(frozen=True)
class Stage:
    name: str
    kind: str
    url: str
    key: str
    model: str
    server: str | None
    voice: str

    @property
    def external(self) -> bool:
        return self.server is None and bool(self.url)

    @property
    def inprocess(self) -> bool:
        return not self.url


def stage(name: str) -> Stage:
    """A stage with every override applied: `.env` over the file, a voice choice over both."""
    return _resolve(name, ())


def _resolve(name: str, chain: tuple[str, ...]) -> Stage:
    stages = spec().get("stages", {})
    if name not in stages:
        raise ConfigError(f"unknown AI stage: {name}")
    if name in chain:
        raise ConfigError(f"stage {name} uses itself: {' -> '.join((*chain, name))}")
    raw = stages[name]
    upper = name.upper()
    if "use" in raw:
        base = _resolve(raw["use"], (*chain, name))
        url, key, model, server, voice = base.url, base.key, base.model, base.server, base.voice
    else:
        url, key, model, server, voice = "", "", "", None, ""
    if raw.get("server"):
        port = servers()[raw["server"]]["port"]
        url, server = f"http://127.0.0.1:{port}/v1", raw["server"]
    url = raw.get("url", url)
    model = raw.get("model", model)
    voice = raw.get("voice", voice)
    own_url = env(f"VR_{upper}_URL")
    if own_url:
        url, server = own_url.rstrip("/"), None
    key = env(f"VR_{upper}_KEY") or key
    model = env(f"VR_{upper}_MODEL") or model
    voice = env(f"VR_{upper}_VOICE") or voice
    model = _models.get(name, model)
    return Stage(name, KIND[name], url.rstrip("/"), key, model, server, voice)


def set_model(name: str, value: str) -> None:
    if name not in KIND:
        raise ConfigError(f"unknown AI stage: {name}")
    _models[name] = value


def reset() -> None:
    global _spec
    _models.clear()
    _spec = None
