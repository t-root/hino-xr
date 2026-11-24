"""The one client every AI call goes through, for any stage and any endpoint that speaks the OpenAI HTTP API.

Whoever serves a stage (llama.cpp here, or an API of somebody else) is `config.stage(name).url`; nothing below depends
on it. A failed call raises `AIError` with a line for the log. There is no second source to fall back to.
"""

from __future__ import annotations

import base64
import json
import urllib.error
import urllib.request
import uuid
from collections.abc import Iterator
from typing import Any

from . import config, servers

CHAT_TIMEOUT_S = 120
Message = dict[str, Any]


class AIError(Exception):
    """The call failed; the text is for the log."""


def _stage(name: str) -> config.Stage:
    try:
        found = config.stage(name)
    except config.ConfigError as error:
        raise AIError(str(error)) from error
    return found


def _need_url(stage: config.Stage) -> None:
    if not stage.url:
        raise AIError(f"{stage.name} has no url: set VR_{stage.name.upper()}_URL")


def _request(stage: config.Stage, path: str, data: bytes | None, content_type: str, timeout: float) -> Any:
    _need_url(stage)
    headers = {"Content-Type": content_type}
    if stage.key:
        headers["Authorization"] = f"Bearer {stage.key}"
    request = urllib.request.Request(stage.url + path, data=data, headers=headers, method="GET" if data is None else "POST")
    try:
        return urllib.request.urlopen(request, timeout=timeout)
    except urllib.error.HTTPError as error:  # before URLError: it is a subclass
        raise AIError(f"{stage.name}: {path} answered {error.code}: {error.read()[:200]!r}") from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise AIError(f"{stage.name}: {path} failed: {error}") from error


def _serve(stage: config.Stage) -> Any:
    """Hold the stage's server for the length of the call. Starting it can fail, and that is an AIError too."""
    ready(stage.name)
    return servers.use(stage.server)


def _body(stage: config.Stage, messages: list[Message], max_tokens: int, temperature: float, stream: bool, tools: list[dict[str, Any]] | None) -> bytes:
    body: dict[str, Any] = {
        "model": stage.model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": stream,
    }
    if tools:
        body["tools"] = tools
    return json.dumps(body).encode("utf-8")


def chat(
    name: str,
    messages: list[Message],
    max_tokens: int = 256,
    temperature: float = 0.5,
    tools: list[dict[str, Any]] | None = None,
    timeout: float = CHAT_TIMEOUT_S,
) -> dict[str, Any]:
    """One whole answer, as the endpoint sent it (an OpenAI chat completion)."""
    stage = _stage(name)
    try:
        with _serve(stage):
            with _request(stage, "/chat/completions", _body(stage, messages, max_tokens, temperature, False, tools), "application/json", timeout) as response:
                return json.loads(response.read())
    except ValueError as error:
        raise AIError(f"{name}: the answer is not JSON: {error}") from error


def chat_stream(name: str, messages: list[Message], max_tokens: int = 256, temperature: float = 0.5, timeout: float = CHAT_TIMEOUT_S) -> Iterator[str]:
    """The answer a piece at a time, as it is written."""
    stage = _stage(name)
    with _serve(stage):
        with _request(stage, "/chat/completions", _body(stage, messages, max_tokens, temperature, True, None), "application/json", timeout) as response:
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


def _content(reply: dict[str, Any], name: str) -> str:
    try:
        return str(reply["choices"][0]["message"]["content"] or "")
    except (KeyError, IndexError, TypeError) as error:
        raise AIError(f"{name}: the answer has no message: {reply!r:.200}") from error


def text(name: str, system: str, user: str, max_tokens: int, timeout: float = 300) -> str:
    """A single question with a system line, answered whole: what plugin writing needs."""
    reply = chat(name, [{"role": "system", "content": system}, {"role": "user", "content": user}], max_tokens, 0.3, timeout=timeout)
    return _content(reply, name)


def see(name: str, image_jpeg: bytes, prompt: str, max_tokens: int = 300) -> str:
    """A question about one picture, answered by a model that reads pictures (an `image_url` data URI)."""
    uri = "data:image/jpeg;base64," + base64.b64encode(image_jpeg).decode("ascii")
    reply = chat(
        name,
        [{"role": "user", "content": [{"type": "image_url", "image_url": {"url": uri}}, {"type": "text", "text": prompt}]}],
        max_tokens,
        0.2,
        timeout=120,
    )
    return _content(reply, name).strip()


def _field(boundary: str, field: str, value: str) -> bytes:
    return f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"\r\n\r\n{value}\r\n'.encode()


def transcribe(wav_bytes: bytes, language: str | None = None, prompt: str | None = None, careful: bool = False) -> str:
    """Speech to text (`/audio/transcriptions`). `prompt` is the words to expect; `careful` weighs more candidates."""
    stage = _stage("stt")
    boundary = uuid.uuid4().hex
    parts = [_field(boundary, "model", stage.model), _field(boundary, "response_format", "json"), _field(boundary, "temperature", "0")]
    if language:
        parts.append(_field(boundary, "language", language))
    if prompt:
        parts.append(_field(boundary, "prompt", prompt[:224]))
    if careful and stage.server:
        parts.append(_field(boundary, "beam_size", "5"))  # whisper.cpp's own field; an API of somebody else has no such thing
    parts += [
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="in.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode(),
        wav_bytes,
        f"\r\n--{boundary}--\r\n".encode(),
    ]
    with _serve(stage):
        with _request(stage, "/audio/transcriptions", b"".join(parts), f"multipart/form-data; boundary={boundary}", 60) as response:
            try:
                heard = json.loads(response.read()).get("text", "")
            except ValueError as error:
                raise AIError(f"stt: the answer is not JSON: {error}") from error
    return str(heard).strip()


def speak(text_to_say: str, speed: float = 1.0) -> bytes:
    """Text to a WAV file (`/audio/speech`), for a `tts` stage that has an url."""
    stage = _stage("tts")
    body = {
        "model": stage.model,
        "input": text_to_say,
        "voice": stage.voice or "alloy",
        "response_format": "wav",
        "speed": max(0.25, min(4.0, float(speed))),
    }
    with _serve(stage):
        with _request(stage, "/audio/speech", json.dumps(body).encode("utf-8"), "application/json", 60) as response:
            audio = response.read()
    if not audio.startswith(b"RIFF"):
        raise AIError(f"tts: the answer is not a WAV file: {audio[:80]!r}")
    return audio


def models(name: str) -> list[str]:
    """The model ids the endpoint of a stage offers (`/models`)."""
    stage = _stage(name)
    with _serve(stage):
        with _request(stage, "/models", None, "application/json", 20) as response:
            try:
                data = json.loads(response.read()).get("data") or []
            except ValueError as error:
                raise AIError(f"{name}: /models is not JSON: {error}") from error
    return sorted(str(item["id"]) for item in data if isinstance(item, dict) and item.get("id"))


def ready(name: str) -> None:
    """Make a stage usable now (start its server) without asking it anything. Raises AIError when it cannot be."""
    stage = _stage(name)
    if stage.server:
        try:
            servers.ensure(stage.server)
        except servers.ServerError as error:
            raise AIError(f"{name}: {error}") from error
