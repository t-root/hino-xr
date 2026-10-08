"""Load and stream a GGUF causal LM through llama.cpp."""

from __future__ import annotations

import json
import os
import threading
from collections.abc import Iterator
from typing import Any

from .catalog import ModelSpec, _env, assistant_greeting, assistant_name, get_spec
from .chunks import next_chunk
from .prompts import system_prompt
from .tuning import VoiceTuning
from .wake import drop_leading_phrase

ChatMessage = dict[str, str]


class Engine:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._load_lock = threading.Lock()
        self._generate_lock = threading.Lock()
        self._spec: ModelSpec | None = None
        self._model: Any = None
        self.state = "idle"
        self.error: str | None = None
        self.device = "cpu"

    def snapshot(self, spec: ModelSpec) -> dict[str, Any]:
        from .speech import speech

        loaded = self._spec is not None and self._spec.id == spec.id
        if not loaded and not spec.path().is_file():
            return {
                "id": spec.id,
                "source": spec.source,
                "state": "failed",
                "device": None,
                "error": (
                    f"GGUF not found: {spec.path()}. "
                    "Put the file there or set VR_MODEL_PATH."
                ),
                "voice": "idle",
                "voiceError": None,
            }
        voice = speech.snapshot()
        return {
            "id": spec.id,
            "source": spec.source,
            "state": self.state if loaded else "idle",
            "device": self.device if loaded else None,
            "error": self.error if loaded else None,
            "voice": voice["state"] if loaded else "idle",
            "voiceError": voice["error"] if loaded else None,
        }

    def load(self, spec: ModelSpec) -> None:
        with self._load_lock:
            with self._lock:
                already = self._spec is not None and self._spec.id == spec.id and self.state == "ready"
                if not already:
                    self.state = "loading"
                    self.error = None
                    self._spec = spec
                    self._model = None
            if already:
                self._ensure_speech()
                return
            try:
                self._load_unlocked(spec)
            except Exception as error:  # noqa: BLE001 — surface any load failure to the web
                with self._lock:
                    self.state = "failed"
                    self.error = str(error)
                    self._model = None
                raise

    def _ensure_speech(self) -> None:
        try:
            from .speech import speech

            if speech.state != "ready":
                speech.ensure()
        except Exception:  # noqa: BLE001 — text still works if voice weights fail
            pass

    def _load_unlocked(self, spec: ModelSpec) -> None:
        from llama_cpp import Llama

        path = spec.path()
        if path.suffix.lower() != ".gguf":
            raise ValueError(f"expected a .gguf file, got {path}")
        if not path.is_file():
            raise FileNotFoundError(
                f"GGUF not found: {path}. Put the file there or set VR_MODEL_PATH."
            )
        gpu_layers = int(_env("VR_N_GPU_LAYERS") or "0")
        model = Llama(
            model_path=str(path),
            n_ctx=int(_env("VR_N_CTX") or "4096"),
            n_gpu_layers=gpu_layers,
            n_threads=int(_env("VR_N_THREADS") or os.cpu_count() or 4),
            chat_format=_env("VR_CHAT_FORMAT") or "qwen",
            verbose=False,
        )
        # The first call pays for loading the weights into cache and for reading the
        # system prompt. Do it now so the first real question is not the slow one.
        try:
            model.create_chat_completion(
                messages=_with_system([{"role": "user", "content": "Xin chào"}], "vi"), max_tokens=1
            )
        except Exception:  # noqa: BLE001 — warming up is an optimisation, not a requirement
            pass
        with self._lock:
            self._model = model
            self.device = "gpu" if gpu_layers != 0 else "cpu"
            self.state = "ready"
            self.error = None
        self._ensure_speech()

    def generate(
        self, spec: ModelSpec, messages: list[ChatMessage], max_tokens: int, locale: str = "vi"
    ) -> Iterator[str]:
        self.load(spec)
        with self._lock:
            model = self._model
        if model is None:
            raise RuntimeError(self.error or "model is not ready")

        capped = max(8, min(int(max_tokens), 512))
        with self._generate_lock:
            stream = model.create_chat_completion(
                messages=_with_system(messages, locale),
                max_tokens=capped,
                temperature=0.5,
                stream=True,
            )
            for chunk in stream:
                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = (choices[0].get("delta") or {}).get("content")
                if delta:
                    yield delta

    def reply(
        self,
        spec: ModelSpec,
        messages: list[ChatMessage],
        max_tokens: int,
        voice: bool,
        locale: str,
        tuning: VoiceTuning | None = None,
    ) -> Iterator[dict[str, Any]]:
        # Speak each sentence as soon as it is written, while the model goes on with the next.
        pending = ""
        first = True
        for token in self.generate(spec, messages, max_tokens, locale):
            yield {"type": "token", "text": token}
            if not voice:
                continue
            pending += token
            while True:
                cut = next_chunk(pending, first)
                if cut is None:
                    break
                piece, pending = cut
                first = False
                audio = _tts(piece, locale, tuning)
                if audio:
                    yield audio
        if voice and pending.strip():
            audio = _tts(pending, locale, tuning)
            if audio:
                yield audio

    def talk(
        self,
        spec: ModelSpec,
        wav_bytes: bytes,
        locale: str,
        history: list[ChatMessage] | None = None,
        tuning: VoiceTuning | None = None,
        strip_wake: bool = False,
    ) -> Iterator[dict[str, Any]]:
        from .speech import speech

        self.load(spec)
        speech.ensure()
        heard = speech.transcribe(wav_bytes, locale)
        if strip_wake:
            # Said as "hino, what time is it": the name is a call, not part of the question.
            heard = drop_leading_phrase(heard, assistant_name())
        if not heard:
            yield {"type": "error", "error": "no speech"}
            return
        yield {"type": "transcript", "text": heard}
        prior = [item for item in (history or []) if item.get("content", "").strip()]
        yield from self.reply(spec, [*prior, {"role": "user", "content": heard}], 128, True, locale, tuning)

    def wake(
        self,
        spec: ModelSpec,
        locale: str,
        tuning: VoiceTuning | None = None,
        greeting: str | None = None,
    ) -> Iterator[dict[str, Any]]:
        """Say the first line. It is the wearer's own text, spoken as written, not asked of the model.

        `greeting` is None for "use the default" and empty for "say nothing".
        """
        self.load(spec)
        yield {"type": "status", "state": self.state}
        text = (assistant_greeting(locale) if greeting is None else greeting).strip()
        if not text:
            return
        yield {"type": "token", "text": text}
        audio = _tts(text, locale, tuning)
        if audio:
            yield audio


def _tts(text: str, locale: str, tuning: VoiceTuning | None) -> dict[str, Any] | None:
    from .speech import b64, speech

    try:
        audio = speech.synthesize(text, locale, tuning)
    except Exception:  # noqa: BLE001 — a missing voice file must not drop the text
        return None
    if not audio:
        return None
    return {"type": "audio", "mime": "audio/wav", "data": b64(audio)}


def _with_system(messages: list[ChatMessage], locale: str) -> list[ChatMessage]:
    if messages and messages[0].get("role") == "system":
        return messages
    return [{"role": "system", "content": system_prompt(locale)}, *messages]


def parse_messages(raw: Any) -> list[ChatMessage]:
    if not isinstance(raw, list) or len(raw) == 0:
        raise ValueError("messages must be a non-empty list")
    messages: list[ChatMessage] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("each message must be an object")
        role = item.get("role")
        content = item.get("content")
        if role not in {"system", "user", "assistant"} or not isinstance(content, str) or not content.strip():
            raise ValueError("message needs role and non-empty content")
        messages.append({"role": role, "content": content})
    return messages


def sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


engine = Engine()


def resolve(model_id: str) -> ModelSpec:
    spec = get_spec(model_id)
    if spec is None:
        raise KeyError(model_id)
    return spec
