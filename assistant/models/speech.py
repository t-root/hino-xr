"""Speech in and speech out on Core. The web sends a WAV and plays a WAV.

STT is a local Whisper GGML/GGUF file (whisper.cpp). TTS is a local Piper
voice for Vietnamese and the machine's own SAPI voice for English. Neither
path loads a remote checkpoint.
"""

from __future__ import annotations

import base64
import io
import os
import random
import re
import sys
import tempfile
import threading
import wave
from array import array
from pathlib import Path
from typing import Any

from .catalog import _env, voice_vi_dir, whisper_path, whisper_wake_path
from .tuning import VoiceTuning, default_tuning, voice_spec

MAX_SPEAK_CHARS = 400


class Speech:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stt: Any = None
        self._stt_run = threading.Lock()  # one Whisper run at a time: the model is not re-entrant
        # A second, smaller Whisper for the short checks that wait for the call ("hino"): a
        # big one takes seconds per line on a CPU, and the wearer waits for that to be heard.
        self._wake: Any = None
        self._wake_run = threading.Lock()
        self._tts_lock = threading.Lock()
        self._tts_vi: Any = None
        # Noise and silence are fixed when the Piper model is built, so a change rebuilds it.
        self._tts_vi_key: tuple[float, float, float] | None = None
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
        self._stt = _load_whisper(whisper_path(), "VR_WHISPER_PATH")
        wake = whisper_wake_path()
        # No second file, or the same one: one model does both jobs.
        self._wake = _load_whisper(wake, "VR_WHISPER_WAKE_PATH") if wake.is_file() and wake != whisper_path() else None
        self.state = "ready"
        self.error = None

    def transcribe(
        self,
        wav_bytes: bytes,
        locale: str,
        language: str | None = None,
        prompt: str | None = None,
        careful: bool = False,
        quick: bool = False,
    ) -> str:
        """Speech to text. `language` overrides the locale's; `prompt` hints at the words to expect.

        `careful` searches more candidate sentences (beam search): slower, right more often.
        It is for what the wearer says to the assistant; the short checks for the wake
        words stay quick; `quick` runs them on the small model when there is one.
        """
        self.ensure(locale)
        with self._lock:
            stt = self._wake if quick and self._wake is not None else self._stt
        run_lock = self._wake_run if stt is self._wake and stt is not None else self._stt_run
        if stt is None:
            raise RuntimeError(self.error or "speech is not ready")
        language = language or ("vi" if locale == "vi" else "en")
        wav_bytes = _pad_wav(_clean(_to_16k_mono(wav_bytes)))
        options: dict[str, Any] = {"language": language, "audio_ctx": _audio_ctx(wav_bytes)}
        if prompt:
            options["initial_prompt"] = prompt
        if careful:
            options["beam_search"] = {"beam_size": BEAM_SIZE, "patience": -1}
        with tempfile.TemporaryDirectory() as folder:
            dest = Path(folder) / "in.wav"
            dest.write_bytes(wav_bytes)
            with run_lock:
                segments = stt.transcribe(str(dest), **options)
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

    def synthesize(self, text: str, locale: str, tuning: VoiceTuning | None = None) -> bytes:
        spoken = speakable(text)
        if not spoken:
            return b""
        tuning = tuning or default_tuning()
        if locale == "vi":
            return self._piper_vi(spoken, tuning)
        return _sapi(spoken, locale, tuning)

    def _piper_vi(self, spoken: str, tuning: VoiceTuning) -> bytes:
        """Windows ships no Vietnamese SAPI voice, so Vietnamese is a local Piper VITS."""
        key = (tuning.expression, tuning.rhythm, tuning.pause)
        with self._tts_lock:
            if self._tts_vi is None or self._tts_vi_key != key:
                self._tts_vi = _load_piper(voice_vi_dir(), tuning)
                self._tts_vi_key = key
            # Synthesize slower, play back faster: pitch moves by `ratio`, duration does not.
            ratio = tuning.pitch_hz / voice_spec()["nativeHz"]
            audio = self._tts_vi.generate(spoken, sid=0, speed=tuning.speed / ratio)
        return _pcm16_wav(audio.samples, round(audio.sample_rate * ratio))


STT_RATE = 16_000
BEAM_SIZE = 5


def _load_whisper(path: Path, variable: str) -> Any:
    from pywhispercpp.model import Model

    if not path.is_file():
        raise FileNotFoundError(f"Whisper GGUF/GGML not found: {path}. Put the file there or set {variable}.")
    return Model(
        str(path),
        n_threads=int(_env("VR_N_THREADS") or os.cpu_count() or 4),
        print_progress=False,
        print_realtime=False,
    )


def _to_16k_mono(wav_bytes: bytes) -> bytes:
    """Whisper reads 16 kHz mono only. A phone's microphone is 44.1 or 48 kHz."""
    import numpy as np

    try:
        with wave.open(io.BytesIO(wav_bytes)) as clip:
            params = clip.getparams()
            frames = clip.readframes(clip.getnframes())
    except (wave.Error, EOFError):
        return wav_bytes
    if params.sampwidth != 2 or (params.framerate == STT_RATE and params.nchannels == 1):
        return wav_bytes
    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32)
    if params.nchannels > 1:
        samples = samples[: len(samples) // params.nchannels * params.nchannels]
        samples = samples.reshape(-1, params.nchannels).mean(axis=1)
    if params.framerate != STT_RATE and len(samples) > 1:
        count = max(1, int(len(samples) * STT_RATE / params.framerate))
        samples = np.interp(np.linspace(0, len(samples) - 1, count), np.arange(len(samples)), samples)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(STT_RATE)
        out.writeframes(np.clip(samples, -32768, 32767).astype("<i2").tobytes())
    return buffer.getvalue()


TARGET_PEAK = 0.7
MAX_GAIN = 8.0
HIGH_PASS_HZ = 80
EDGE_SECONDS = 0.25
EDGE_LEVEL = 0.02


def _clean(wav_bytes: bytes) -> bytes:
    """What a quiet or rumbling microphone gets wrong, put right before Whisper reads it.

    Low rumble under about 80 Hz is taken out, the level is raised so the loudest sound reaches
    about 70% of full scale (at most eight times: hiss is not made into speech), and
    silence at both ends is trimmed to a quarter of a second so Whisper does not spend its
    guesses on it. Audio that is not 16 kHz mono 16-bit passes through untouched.
    """
    import numpy as np

    try:
        with wave.open(io.BytesIO(wav_bytes)) as clip:
            params = clip.getparams()
            frames = clip.readframes(clip.getnframes())
    except (wave.Error, EOFError):
        return wav_bytes
    if params.sampwidth != 2 or params.nchannels != 1 or params.framerate != STT_RATE or params.nframes < 400:
        return wav_bytes
    samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
    samples = samples - samples.mean()
    # Rumble out: subtract a moving average about one period of HIGH_PASS_HZ long.
    window = max(2, STT_RATE // HIGH_PASS_HZ)
    padded = np.concatenate([np.full(window // 2, samples[0]), samples, np.full(window - window // 2, samples[-1])])
    running = np.cumsum(np.insert(padded, 0, 0.0))
    filtered = samples - (running[window : window + len(samples)] - running[: len(samples)]) / window
    peak = float(np.max(np.abs(filtered)))
    if peak > 1e-4:
        filtered = filtered * min(MAX_GAIN, TARGET_PEAK / peak)
    loud = np.flatnonzero(np.abs(filtered) > EDGE_LEVEL)
    if loud.size:
        margin = int(EDGE_SECONDS * STT_RATE)
        filtered = filtered[max(0, loud[0] - margin) : min(len(filtered), loud[-1] + margin)]
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(STT_RATE)
        out.writeframes((np.clip(filtered, -1.0, 1.0) * 32767).astype("<i2").tobytes())
    return buffer.getvalue()


MIN_STT_SECONDS = 1.5
LEAD_SECONDS = 0.35
_HISS = 130  # about 0.4% of full scale: room noise, not silence


def _pad_wav(wav_bytes: bytes) -> bytes:
    """Make a lone word long enough to be heard.

    whisper.cpp answers nothing at all for audio under a second, and a bare "hino"
    with dead silence around it is often taken for noise. A little room-like hiss
    before and after, up to a second and a half, is read as the word it is.
    """
    try:
        with wave.open(io.BytesIO(wav_bytes)) as clip:
            params = clip.getparams()
            frames = clip.readframes(clip.getnframes())
    except (wave.Error, EOFError):
        return wav_bytes
    if params.sampwidth != 2 or params.nchannels != 1:
        return wav_bytes
    total = int(MIN_STT_SECONDS * params.framerate)
    if params.nframes >= total:
        return wav_bytes
    lead = int(LEAD_SECONDS * params.framerate)
    tail = max(0, total - params.nframes - lead)
    hiss = lambda count: array("h", (int(random.gauss(0, _HISS)) for _ in range(count)))  # noqa: E731
    pcm = hiss(lead)
    pcm.frombytes(frames)
    pcm.extend(hiss(tail))
    if sys.byteorder == "big":
        pcm.byteswap()
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setparams(params)
        out.writeframes(pcm.tobytes())
    return buffer.getvalue()


def _audio_ctx(wav_bytes: bytes) -> int:
    """Whisper reads 30 seconds of audio unless told otherwise, 50 frames a second.

    A spoken question is a few seconds, so reading only that much is several times
    faster and the words come out the same.
    """
    try:
        with wave.open(io.BytesIO(wav_bytes)) as clip:
            seconds = clip.getnframes() / float(clip.getframerate())
    except (wave.Error, EOFError, ZeroDivisionError):
        return 1500
    return max(250, min(1500, int(seconds * 50) + 100))


def _load_piper(folder: Path, tuning: VoiceTuning) -> Any:
    import sherpa_onnx

    models = sorted(folder.glob("*.onnx"))
    if not models or not (folder / "tokens.txt").is_file():
        raise FileNotFoundError(
            f"Vietnamese voice not found: {folder}. Put the Piper vi_VN folder there or set VR_VOICE_VI_PATH."
        )
    vits = sherpa_onnx.OfflineTtsVitsModelConfig(
        model=str(models[0]),
        tokens=str(folder / "tokens.txt"),
        data_dir=str(folder / "espeak-ng-data"),
        noise_scale=tuning.expression,
        noise_scale_w=tuning.rhythm,
    )
    config = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(vits=vits, num_threads=2),
        silence_scale=tuning.pause,
    )
    return sherpa_onnx.OfflineTts(config)


def _pcm16_wav(samples: Any, sample_rate: int) -> bytes:
    pcm = array("h", (max(-32768, min(32767, int(s * 32767))) for s in samples))
    if sys.byteorder == "big":
        pcm.byteswap()
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(int(sample_rate))
        out.writeframes(pcm.tobytes())
    return buffer.getvalue()


def _sapi(spoken: str, locale: str, tuning: VoiceTuning) -> bytes:
    import pyttsx3

    engine = pyttsx3.init()
    engine.setProperty("rate", int(engine.getProperty("rate") * tuning.speed))
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


_LANGUAGE = {
    # A bare "vi" or "en" also sits inside "Da-vi-d", so match whole tokens or the language name.
    "vi": re.compile(r"(?<![a-z])vi(?![a-z])|vietnam"),
    "en": re.compile(r"(?<![a-z])en(?![a-z])|english"),
}


def _voice_for(engine: Any, locale: str) -> str | None:
    pattern = _LANGUAGE["vi" if locale == "vi" else "en"]
    for voice in engine.getProperty("voices") or []:
        blob = f"{getattr(voice, 'id', '')} {getattr(voice, 'name', '')} {getattr(voice, 'languages', '')}".lower()
        if pattern.search(blob):
            return voice.id
    return None


def speakable(text: str) -> str:
    cleaned = re.sub(r"[#*_`>]+", "", text)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:MAX_SPEAK_CHARS]


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


speech = Speech()
