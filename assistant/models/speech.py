"""Speech in and speech out on Core. The web sends a WAV and plays a WAV.

STT is a local Whisper GGML/GGUF file (whisper.cpp). TTS is the machine's
own voice. Neither path loads a remote checkpoint.
"""

from __future__ import annotations

import base64
import re
import tempfile
import threading
from pathlib import Path
from typing import Any

from .catalog import whisper_path

MAX_SPEAK_CHARS = 400


class Speech:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stt: Any = None
        self.state = "idle"
        self.error: str | None = None

    def snapshot(self) -> dict[str, str | None]:
        return {"state": self.state, "error": self.error}

    def ensure(self, locale: str = "vi") -> None:
        del locale  # language is chosen per transcribe call
        with self._lock:
            if self._stt is not None:
                return
            self.state = "loading"
            self.error = None
            try:
                self._load_unlocked()
            except Exception as error:  # noqa: BLE001
                self.state = "failed"
                self.error = str(error)
                self._stt = None
                raise

    def _load_unlocked(self) -> None:
        from pywhispercpp.model import Model

        path = whisper_path()
        if not path.is_file():
            raise FileNotFoundError(
                f"Whisper GGUF/GGML not found: {path}. Put the file there or set VR_WHISPER_PATH."
            )
        self._stt = Model(str(path), n_threads=4)
        self.state = "ready"
        self.error = None

    def transcribe(self, wav_bytes: bytes, locale: str) -> str:
        self.ensure(locale)
        with self._lock:
            stt = self._stt
        if stt is None:
            raise RuntimeError(self.error or "speech is not ready")
        language = "vi" if locale == "vi" else "en"
        with tempfile.TemporaryDirectory() as folder:
            dest = Path(folder) / "in.wav"
            dest.write_bytes(wav_bytes)
            segments = stt.transcribe(str(dest), language=language)
        if isinstance(segments, str):
            return segments.strip()
        parts = []
        for segment in segments or []:
            if isinstance(segment, dict):
                text = str(segment.get("text") or "")
            else:
                text = str(getattr(segment, "text", None) or "")
            if text.strip():
                parts.append(text.strip())
        return " ".join(parts).strip()

    def synthesize(self, text: str, locale: str) -> bytes:
        spoken = speakable(text)
        if not spoken:
            return b""
        import pyttsx3

        engine = pyttsx3.init()
        voice_id = _voice_for(engine, locale)
        if voice_id:
            engine.setProperty("voice", voice_id)
        with tempfile.TemporaryDirectory() as folder:
            dest = Path(folder) / "out.wav"
            try:
                engine.save_to_file(spoken, str(dest))
                engine.runAndWait()
                return dest.read_bytes() if dest.is_file() else b""
            finally:
                try:
                    engine.stop()
                except Exception:  # noqa: BLE001 — SAPI often errors on stop after save
                    pass


def _voice_for(engine: Any, locale: str) -> str | None:
    needle = "vi" if locale == "vi" else "en"
    for voice in engine.getProperty("voices") or []:
        blob = f"{getattr(voice, 'id', '')} {getattr(voice, 'name', '')} {getattr(voice, 'languages', '')}".lower()
        if needle in blob:
            return voice.id
    return None


def speakable(text: str) -> str:
    cleaned = re.sub(r"[#*_`>]+", "", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:MAX_SPEAK_CHARS]


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


speech = Speech()
