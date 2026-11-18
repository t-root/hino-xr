"""SiliconFlow, the one cloud source for every stage that can run on this machine instead.

Each stage has its own switch in `.env` and defaults to `local` (offline):

    VR_LLM_SOURCE   the answer to a spoken question          (llama.cpp Qwen locally)
    VR_STT_SOURCE   speech to text                           (whisper.cpp locally)
    VR_TTS_SOURCE   text to speech                           (VieNeu / SAPI locally)
    VR_CODE_SOURCE  writing plugins and working the menu     (see pluginsmith.py)

A stage runs in the cloud only when its switch says `api` (`siliconflow` and `cloud` mean the same)
and `VR_SILICONFLOW_KEY` is set. When a cloud call fails the caller goes on with the local model, and
the stage is not tried again for a minute so a lost connection does not cost a timeout per sentence.

SiliconFlow's speech models do not list Vietnamese (SenseVoice and TeleSpeech hear Chinese and English,
CosyVoice2 and Fish-Speech speak a handful of languages), so speech in and out goes to the cloud
only for the locales in `VR_CLOUD_VOICE_LANGS` (default `en`). Add `vi` there to try it anyway.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Iterator
from typing import Any

from .catalog import _env

DEFAULT_BASE_URL = "https://api.siliconflow.com/v1"
DEFAULT_MODELS = {
    "VR_LLM_MODEL": "Qwen/Qwen2.5-7B-Instruct",
    "VR_STT_MODEL": "FunAudioLLM/SenseVoiceSmall",
    "VR_TTS_MODEL": "FunAudioLLM/CosyVoice2-0.5B",
}
# One language model does it all, as the local Qwen does; these two only override it, in the cloud,
# when a stronger model is wanted for writing plugins or for working the menu.
FOLLOWS_LLM = ("VR_CODE_MODEL", "VR_AGENT_MODEL")
DEFAULT_VOICE = "alex"
TTS_RATE = 32_000
RETRY_AFTER_S = 60
CHAT_TIMEOUT_S = 60
STAGES = {"chat": "VR_LLM_SOURCE", "stt": "VR_STT_SOURCE", "tts": "VR_TTS_SOURCE"}
MAX_MESSAGES = 10  # the chat endpoint takes 1 to 10 messages

_down_until: dict[str, float] = {}


class CloudError(Exception):
    """The cloud call failed; the text is for the log."""


def api_key() -> str | None:
    return _env("VR_SILICONFLOW_KEY") or _env("SILICONFLOW_API_KEY")


# What the wearer chose by voice while running. It wins over `.env` and is gone at the next start.
_sources: dict[str, str] = {}
_models: dict[str, str] = {}


def model(name: str) -> str:
    """The model for a variable: chosen by voice, else its own value, else (code, agent) the language model's, else the default."""
    if name in _models:
        return _models[name]
    if name in FOLLOWS_LLM:
        return _env(name) or model("VR_LLM_MODEL")
    return _env(name) or DEFAULT_MODELS[name]


def set_model(name: str, value: str) -> None:
    _models[name] = value


def normalize(value: str | None) -> str:
    """`local` or `api`; anything that names the cloud is `api`."""
    return "api" if (value or "").strip().lower() in {"api", "siliconflow", "cloud"} else "local"


def source(stage: str) -> str:
    """`local` or `api` for chat, stt, tts: chosen by voice, else from `.env`."""
    return _sources.get(stage) or normalize(_env(STAGES[stage]))


def set_source(stage: str, value: str) -> bool:
    """Switch a stage while running. The cloud needs a key; without one the stage stays as it was."""
    value = normalize(value)
    if value == "api" and not api_key():
        return False
    _sources[stage] = value
    return True


_LISTING = {"chat": {"sub_type": "chat"}, "stt": {"sub_type": "speech-to-text"}, "tts": {"type": "audio"}}
_listed: dict[str, tuple[float, list[str]]] = {}
LIST_CACHE_S = 300


def models_for(stage: str) -> list[str]:
    """The ids SiliconFlow offers for a stage (chat, stt, tts), asked of the account's own key and kept five minutes."""
    now = time.monotonic()
    if stage in _listed and now - _listed[stage][0] < LIST_CACHE_S:
        return _listed[stage][1]
    query = "&".join(f"{key}={value}" for key, value in _LISTING[stage].items())
    key = api_key()
    if not key:
        raise CloudError("SiliconFlow key missing (VR_SILICONFLOW_KEY)")
    request = urllib.request.Request(
        (_env("VR_SILICONFLOW_URL") or DEFAULT_BASE_URL).rstrip("/") + f"/models?{query}",
        headers={"Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.loads(response.read()).get("data") or []
    except urllib.error.HTTPError as error:
        raise CloudError(f"/models answered {error.code}") from error
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
        raise CloudError(f"/models failed: {error}") from error
    ids = sorted(str(item["id"]) for item in data if isinstance(item, dict) and item.get("id"))
    if stage == "tts":
        # type=audio lists the listening models too; they are not what speaks.
        listening = set(models_for("stt"))
        ids = [name for name in ids if name not in listening]
    _listed[stage] = (now, ids)
    return ids


def voice_langs() -> set[str]:
    """The languages whose listening and speaking may go to the cloud."""
    return {item.strip() for item in (_env("VR_CLOUD_VOICE_LANGS") or "en").lower().split(",") if item.strip()}


def wants(stage: str, locale: str | None = None) -> bool:
    """Should this stage go to the cloud now: switched on, key present, locale allowed, not just failed."""
    if source(stage) != "api" or not api_key():
        return False
    if stage != "chat" and locale is not None and locale.lower() not in voice_langs():
        return False
    return time.monotonic() >= _down_until.get(stage, 0.0)


def failed(stage: str) -> None:
    _down_until[stage] = time.monotonic() + RETRY_AFTER_S


def reset() -> None:
    """Forget failures, voice choices and the lists asked for. Used by tests."""
    _down_until.clear()
    _sources.clear()
    _models.clear()
    _listed.clear()


def _open(path: str, data: bytes, content_type: str, timeout: float) -> Any:
    key = api_key()
    if not key:
        raise CloudError("SiliconFlow key missing (VR_SILICONFLOW_KEY)")
    request = urllib.request.Request(
        (_env("VR_SILICONFLOW_URL") or DEFAULT_BASE_URL).rstrip("/") + path,
        data=data,
        headers={"Authorization": f"Bearer {key}", "Content-Type": content_type},
    )
    try:
        return urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as error:  # before URLError: it is a subclass
        raise CloudError(f"{path} answered {error.code}: {error.read()[:200]!r}") from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise CloudError(f"{path} failed: {error}") from error


def _fit(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The system line, then as much of the end of the talk as the endpoint takes."""
    if len(messages) <= MAX_MESSAGES:
        return messages
    head = messages[:1] if messages[0].get("role") == "system" else []
    return [*head, *messages[len(messages) - (MAX_MESSAGES - len(head)) :]]


def chat(body: dict[str, Any], timeout: float = CHAT_TIMEOUT_S) -> dict[str, Any]:
    """One whole answer. `body` is an OpenAI-style chat request without `stream`."""
    body = {**body, "messages": _fit(body["messages"]), "stream": False}
    try:
        with _open("/chat/completions", json.dumps(body).encode("utf-8"), "application/json", timeout) as response:
            return json.loads(response.read())
    except ValueError as error:
        raise CloudError(f"chat answered something that is not JSON: {error}") from error


def chat_stream(body: dict[str, Any], timeout: float = CHAT_TIMEOUT_S) -> Iterator[str]:
    """The answer a piece at a time, as it is written."""
    body = {**body, "messages": _fit(body["messages"]), "stream": True}
    with _open("/chat/completions", json.dumps(body).encode("utf-8"), "application/json", timeout) as response:
        for raw in response:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if data == "[DONE]":
                return
            try:
                choices = json.loads(data).get("choices") or []
            except ValueError:
                continue
            if not choices:
                continue
            piece = (choices[0].get("delta") or choices[0].get("message") or {}).get("content")
            if piece:
                yield piece


def complete_text(name: str, system: str, user: str, max_tokens: int) -> str:
    """A single question with a system line, answered whole: what plugin writing needs."""
    reply = chat(
        {
            "model": model(name),
            "max_tokens": max_tokens,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        },
        timeout=180,
    )
    try:
        return str(reply["choices"][0]["message"]["content"] or "")
    except (KeyError, IndexError, TypeError) as error:
        raise CloudError(f"chat answered without a message: {reply!r:.200}") from error


_TAGS = re.compile(r"<\|[^|]*\|>")


def transcribe(wav_bytes: bytes) -> str:
    """Speech to text. SenseVoice puts markers like <|en|><|NEUTRAL|> in front of the words; they are dropped."""
    boundary = uuid.uuid4().hex
    parts = [
        f'--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n{model("VR_STT_MODEL")}\r\n'.encode(),
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="in.wav"\r\n'
        "Content-Type: audio/wav\r\n\r\n".encode(),
        wav_bytes,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    with _open("/audio/transcriptions", b"".join(parts), f"multipart/form-data; boundary={boundary}", 30) as response:
        try:
            text = json.loads(response.read()).get("text", "")
        except ValueError as error:
            raise CloudError(f"transcription answered something that is not JSON: {error}") from error
    return _TAGS.sub("", str(text)).strip()


def speak(text: str, speed: float = 1.0) -> bytes:
    """Text to a WAV file."""
    name = model("VR_TTS_MODEL")
    voice = _env("VR_TTS_VOICE") or DEFAULT_VOICE
    body = {
        "model": name,
        "input": text,
        "voice": voice if ":" in voice else f"{name}:{voice}",
        "response_format": "wav",
        "sample_rate": TTS_RATE,
        "speed": max(0.25, min(4.0, float(speed))),
        "stream": False,
    }
    with _open("/audio/speech", json.dumps(body).encode("utf-8"), "application/json", 30) as response:
        audio = response.read()
    if not audio.startswith(b"RIFF"):
        raise CloudError(f"speech answered something that is not a WAV file: {audio[:80]!r}")
    return audio
