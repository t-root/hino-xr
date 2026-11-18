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

Listening and speaking can instead use another provider that does hear and speak Vietnamese, each on its own:

    VR_STT_URL / VR_STT_KEY / VR_STT_MODEL   any OpenAI-style `/audio/transcriptions` (Groq: https://api.groq.com/openai/v1,
                                             model whisper-large-v3-turbo; OpenAI: whisper-1)
    VR_TTS_URL / VR_TTS_KEY / VR_TTS_MODEL   any OpenAI-style `/audio/speech` (voice in VR_TTS_VOICE)
    VR_TTS_PROVIDER=azure                    Azure Speech: VR_AZURE_KEY, VR_AZURE_REGION, and the voices
                                             VR_AZURE_VOICE_VI (vi-VN-HoaiMyNeural) / VR_AZURE_VOICE_EN (en-US-JennyNeural)

A stage with such a provider is sent Vietnamese too (`VR_STT_LANGS` / `VR_TTS_LANGS` change which languages).
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
import uuid
from xml.sax.saxutils import escape
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


def provider(stage: str) -> str:
    """Who serves a stage: `siliconflow`, `custom` (an OpenAI-style URL of the wearer's own) or `azure` (speaking only)."""
    if stage == "tts" and (_env("VR_TTS_PROVIDER") or "").lower() == "azure":
        return "azure"
    if (stage == "stt" and _env("VR_STT_URL")) or (stage == "tts" and _env("VR_TTS_URL")):
        return "custom"
    return "siliconflow"


def key_for(stage: str) -> str | None:
    """The key a stage needs: its own provider's, else SiliconFlow's."""
    kind = provider(stage)
    if kind == "azure":
        return _env("VR_AZURE_KEY")
    if kind == "custom":
        return _env("VR_STT_KEY" if stage == "stt" else "VR_TTS_KEY") or api_key()
    return api_key()


# What the wearer chose by voice while running. It wins over `.env` and is gone at the next start.
_sources: dict[str, str] = {}
_models: dict[str, str] = {}


def model(name: str) -> str:
    """The model for a variable: chosen by voice, else its own value, else (code, agent) the language model's, else the default."""
    if name in _models:
        return _models[name]
    if name in FOLLOWS_LLM:
        return _env(name) or model("VR_LLM_MODEL")
    if name == "VR_STT_MODEL" and not _env(name) and _env("VR_STT_URL"):
        return "whisper-large-v3-turbo"
    if name == "VR_TTS_MODEL" and not _env(name) and _env("VR_TTS_URL"):
        return "tts-1"
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
    if value == "api" and not key_for(stage):
        return False
    _sources[stage] = value
    return True


_LISTING = {"chat": {"sub_type": "chat"}, "stt": {"sub_type": "speech-to-text"}, "tts": {"type": "audio"}}
_listed: dict[str, tuple[float, list[str]]] = {}
LIST_CACHE_S = 300


def models_for(stage: str) -> list[str]:
    """The ids SiliconFlow offers for a stage (chat, stt, tts), asked of the account's own key and kept five minutes."""
    if provider(stage) != "siliconflow":
        raise CloudError(f"the list of models is only read from SiliconFlow, and {stage} is served by {provider(stage)}")
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


def voice_langs(stage: str | None = None) -> set[str]:
    """The languages whose listening and speaking may go to the cloud.

    A stage served by a provider of the wearer's own (Groq, OpenAI, Azure) hears and speaks Vietnamese, so it
    sends both languages unless told otherwise; SiliconFlow's own speech models are sent English only.
    """
    own = {"stt": "VR_STT_LANGS", "tts": "VR_TTS_LANGS"}.get(stage or "")
    fallback = "vi,en" if stage and provider(stage) != "siliconflow" else "en"
    raw = (_env(own) if own else None) or _env("VR_CLOUD_VOICE_LANGS") or fallback
    return {item.strip() for item in raw.lower().split(",") if item.strip()}


def wants(stage: str, locale: str | None = None) -> bool:
    """Should this stage go to the cloud now: switched on, key present, locale allowed, not just failed."""
    if source(stage) != "api" or not key_for(stage):
        return False
    if stage != "chat" and locale is not None and locale.lower() not in voice_langs(stage):
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


def _base(stage: str) -> str:
    own = {"stt": "VR_STT_URL", "tts": "VR_TTS_URL"}.get(stage)
    return ((_env(own) if own else None) or _env("VR_SILICONFLOW_URL") or DEFAULT_BASE_URL).rstrip("/")


def _open(path: str, data: bytes, content_type: str, timeout: float, stage: str = "chat") -> Any:
    key = key_for(stage)
    if not key:
        raise CloudError("API key missing (VR_SILICONFLOW_KEY, or the key of the provider chosen for this stage)")
    request = urllib.request.Request(
        _base(stage) + path,
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


def _field(boundary: str, name: str, value: str) -> bytes:
    return f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()


def transcribe(wav_bytes: bytes, language: str | None = None, prompt: str | None = None) -> str:
    """Speech to text. SenseVoice puts markers like <|en|><|NEUTRAL|> in front of the words; they are dropped.

    `language` and `prompt` (the words to expect) are sent only to a provider of the wearer's own: they are
    Whisper's own fields, and SiliconFlow's models do not take them.
    """
    boundary = uuid.uuid4().hex
    parts = [_field(boundary, "model", model("VR_STT_MODEL"))]
    if provider("stt") == "custom":
        if language:
            parts.append(_field(boundary, "language", language))
        if prompt:
            parts.append(_field(boundary, "prompt", prompt[:224]))
    parts += [
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="in.wav"\r\n'
        "Content-Type: audio/wav\r\n\r\n".encode(),
        wav_bytes,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    with _open("/audio/transcriptions", b"".join(parts), f"multipart/form-data; boundary={boundary}", 30, "stt") as response:
        try:
            text = json.loads(response.read()).get("text", "")
        except ValueError as error:
            raise CloudError(f"transcription answered something that is not JSON: {error}") from error
    return _TAGS.sub("", str(text)).strip()


AZURE_VOICES = {"vi": ("VR_AZURE_VOICE_VI", "vi-VN-HoaiMyNeural", "vi-VN"), "en": ("VR_AZURE_VOICE_EN", "en-US-JennyNeural", "en-US")}


def _azure(text: str, speed: float, locale: str) -> bytes:
    """Azure Speech: SSML in, a 24 kHz WAV out. The region names the host unless VR_AZURE_URL says otherwise."""
    variable, default, lang = AZURE_VOICES["vi" if locale == "vi" else "en"]
    region = _env("VR_AZURE_REGION") or "southeastasia"
    url = _env("VR_AZURE_URL") or f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1"
    percent = round((max(0.5, min(2.0, float(speed))) - 1.0) * 100)
    ssml = (
        f"<speak version='1.0' xml:lang='{lang}'><voice name='{_env(variable) or default}'>"
        f"<prosody rate='{percent:+d}%'>{escape(text)}</prosody></voice></speak>"
    )
    request = urllib.request.Request(
        url,
        data=ssml.encode("utf-8"),
        headers={
            "Ocp-Apim-Subscription-Key": key_for("tts") or "",
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "riff-24khz-16bit-mono-pcm",
            "User-Agent": "hino-xr",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        raise CloudError(f"azure speech answered {error.code}") from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise CloudError(f"azure speech failed: {error}") from error


def speak(text: str, speed: float = 1.0, locale: str = "en") -> bytes:
    """Text to a WAV file."""
    if provider("tts") == "azure":
        audio = _azure(text, speed, locale)
    else:
        name = model("VR_TTS_MODEL")
        voice = _env("VR_TTS_VOICE") or ("alloy" if provider("tts") == "custom" else DEFAULT_VOICE)
        body: dict[str, Any] = {
            "model": name,
            "input": text,
            "voice": voice,
            "response_format": "wav",
            "speed": max(0.25, min(4.0, float(speed))),
        }
        if provider("tts") == "siliconflow":
            # SiliconFlow names a voice by its model, and takes these; an OpenAI-style provider rejects them.
            body.update(voice=voice if ":" in voice else f"{name}:{voice}", sample_rate=TTS_RATE, stream=False)
        with _open("/audio/speech", json.dumps(body).encode("utf-8"), "application/json", 30, "tts") as response:
            audio = response.read()
    if not audio.startswith(b"RIFF"):
        raise CloudError(f"speech answered something that is not a WAV file: {audio[:80]!r}")
    return audio
