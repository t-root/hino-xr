"""The assistant's turn: hear a line, work out what it asks for, answer it and say the answer.

Every AI it needs is a stage of `ai/stages.json` (chat, agent, stt, tts); this file holds none of them.
"""

from __future__ import annotations

import json
import threading
import time
from collections import deque
from collections.abc import Iterator
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any

import ai
from . import timing
from .catalog import ModelSpec, assistant_greeting, assistant_name, get_spec
from .chunks import next_chunk
from .prompts import system_prompt
from .tuning import VoiceTuning
from .wake import drop_leading_phrase

ChatMessage = dict[str, str]
MAX_MESSAGES = 40
MAX_MESSAGE_CHARS = 4000


class Engine:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._spec: ModelSpec | None = None
        self.state = "idle"
        self.error: str | None = None

    @staticmethod
    def device() -> str:
        return "api" if ai.stage("chat").external else "local"

    def snapshot(self, spec: ModelSpec) -> dict[str, Any]:
        from .speech import speech

        loaded = self._spec is not None and self._spec.id == spec.id
        voice = speech.snapshot()
        return {
            "id": spec.id,
            "source": ai.stage("chat").url or "-",
            "state": self.state if loaded else "idle",
            "device": self.device() if loaded else None,
            "error": self.error if loaded else None,
            "voice": voice["state"] if loaded else "idle",
            "voiceError": voice["error"] if loaded else None,
        }

    def load(self, spec: ModelSpec) -> None:
        """Make the answering model ready (its server is started here when it is a server of this machine)."""
        with self._lock:
            warm = self._spec == spec and self.state == "ready"
            if not warm:
                self._spec = spec
                self.state = "loading"
                self.error = None
        try:
            ai.ready("chat")
        except ai.AIError as error:
            with self._lock:
                self.state = "failed"
                self.error = str(error)
            raise RuntimeError(str(error)) from error
        with self._lock:
            self.state = "ready"

    def generate(
        self,
        spec: ModelSpec,
        messages: list[ChatMessage],
        max_tokens: int,
        locale: str = "vi",
        ceiling: int = 512,
    ) -> Iterator[str]:
        capped = max(8, min(int(max_tokens), ceiling))
        self.load(spec)
        try:
            yield from ai.chat_stream("chat", _with_system(messages, locale), capped, 0.5)
        except ai.AIError as error:
            with self._lock:
                self.state = "failed"
                self.error = str(error)
            raise RuntimeError(str(error)) from error

    def reply(
        self,
        spec: ModelSpec,
        messages: list[ChatMessage],
        max_tokens: int,
        voice: bool,
        locale: str,
        tuning: VoiceTuning | None = None,
    ) -> Iterator[dict[str, Any]]:
        # Speak each sentence as soon as it is written, while the model goes on with the next: the speech is made
        # on its own thread, one sentence at a time and in order, so the model is never held up waiting for a voice.
        pending = ""
        first = True
        began = time.monotonic()
        first_at: float | None = None
        count = 0
        futures: deque[Future[dict[str, Any] | None]] = deque()

        def ready(wait: bool) -> Iterator[dict[str, Any]]:
            while futures and (wait or futures[0].done()):
                audio = futures.popleft().result()
                if audio:
                    yield audio

        with ThreadPoolExecutor(max_workers=1, thread_name_prefix="speak") as voice_pool:
            for token in self.generate(spec, messages, max_tokens, locale):
                now = time.monotonic()
                if first_at is None:
                    first_at = now
                count += 1
                yield {"type": "token", "text": token}
                if voice:
                    pending += token
                    while True:
                        cut = next_chunk(pending, first)
                        if cut is None:
                            break
                        piece, pending = cut
                        first = False
                        futures.append(voice_pool.submit(_tts, piece, locale, tuning))
                yield from ready(False)
            if voice and pending.strip():
                futures.append(voice_pool.submit(_tts, pending, locale, tuning))
            timing.tokens(count, None if first_at is None else first_at - began, None if first_at is None else time.monotonic() - first_at)
            yield from ready(True)

    def talk(self, *args: Any, **kwargs: Any) -> Iterator[dict[str, Any]]:
        """One spoken turn; how long each part took is logged at the end (`timing`)."""
        timing.begin()
        try:
            yield from self._talk(*args, **kwargs)
            text = timing.finish()
            if text:
                yield {"type": "timing", "text": text}  # the page writes it to its log, so it can be read in the headset
        finally:
            timing.finish()

    def _talk(
        self,
        spec: ModelSpec,
        wav_bytes: bytes,
        locale: str,
        history: list[ChatMessage] | None = None,
        tuning: VoiceTuning | None = None,
        strip_wake: bool = False,
        plugins: list[dict[str, Any]] | None = None,
        controls: list[dict[str, Any]] | None = None,
        lines: dict[str, str] | None = None,
        place: tuple[float, float] | None = None,
    ) -> Iterator[dict[str, Any]]:
        from . import agent, modelswitch, notes, pluginsmith, tools
        from .commands import plugin_command
        from .controls import control_command
        from .person_speech import person_command
        from .screen_speech import screen_command
        from .sight_speech import sight_command
        from .speech import speech

        self.load(spec)
        with timing.measure("listen"):
            heard = speech.transcribe(wav_bytes, locale, prompt=_vocabulary(locale), careful=True)
        if strip_wake:
            # Said as "hino, what time is it": the name is a call, not part of the question.
            heard = drop_leading_phrase(heard, assistant_name())
        print(f"  talk     heard {heard!r}", flush=True)
        if not heard:
            yield {"type": "error", "error": "no speech"}
            return
        yield {"type": "transcript", "text": heard}
        command = plugin_command(heard, plugins or [], locale, pluginsmith.pending())
        if command is None:
            command = modelswitch.command(heard, locale)
        if command is None and controls:
            command = control_command(heard, controls, locale)
        if command is None:
            command = person_command(heard, locale)
        if command is None:
            command = sight_command(heard, locale, lines)
        if command is None:
            command = screen_command(heard, locale, lines)
        if command is None:
            command = tools.command(heard, locale, place)
        if command is None:
            command = notes.command(heard, locale)
        if command:
            # Switching or writing a plugin is the headset's doing, not the model's: say so and stop.
            yield {
                "type": "command",
                "action": command["action"],
                "id": command["id"],
                "description": command.get("description", ""),
                "value": command.get("value"),
            }
            if command.get("open"):
                # Something to look at: open the menu page that prints what the assistant says, so it is on screen now.
                yield {"type": "command", "action": "setting", "id": f"page.{command['open']}", "description": "", "value": True}
            if command["reply"]:
                # The screen gets all of it; the voice reads only the short line.
                yield {"type": "token", "text": command.get("display") or command["reply"]}
                audio = _tts(command["reply"], locale, tuning)
                if audio:
                    yield audio
            return
        if controls or plugins:
            # Not a keyword command: the model may still hear a request in it and call the settings.
            calls = agent.plan(heard, controls or [], plugins or [], locale)
            if calls:
                for call in calls:
                    yield {"type": "command", "action": call["action"], "id": call["id"], "description": "", "value": call.get("value")}
                spoken = " ".join(call["reply"] for call in calls if call["reply"])
                yield {"type": "token", "text": spoken}
                audio = _tts(spoken, locale, tuning)
                if audio:
                    yield audio
                return
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


def _vocabulary(locale: str) -> str:
    """Words Whisper should expect: the assistant's name and what the wearer commands it with."""
    name = assistant_name()
    if locale == "vi":
        return (
            f"{name}, bật plugin, tắt plugin, tạo plugin, duyệt plugin, mở menu, đóng menu, "
            "chẩn đoán, tốc độ đọc, thời gian ngủ, nhận diện khuôn mặt, bản đồ ba D, quét đồ vật, "
            "đổi model, dùng API, dùng local."
        )
    return f"{name}, turn on plugin, turn off plugin, create plugin, open menu, close menu, diagnostics, speaking speed."


def _tts(text: str, locale: str, tuning: VoiceTuning | None) -> dict[str, Any] | None:
    from .speech import b64, speech

    try:
        with timing.measure("speak"):
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
    if len(raw) > MAX_MESSAGES:
        raise ValueError(f"at most {MAX_MESSAGES} messages")
    messages: list[ChatMessage] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("each message must be an object")
        role = item.get("role")
        content = item.get("content")
        if role not in {"system", "user", "assistant"} or not isinstance(content, str) or not content.strip():
            raise ValueError("message needs role and non-empty content")
        messages.append({"role": role, "content": content[:MAX_MESSAGE_CHARS]})  # a spoken turn is short; this is a ceiling
    return messages


def sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


engine = Engine()


def resolve(model_id: str) -> ModelSpec:
    spec = get_spec(model_id)
    if spec is None:
        raise KeyError(model_id)
    return spec
