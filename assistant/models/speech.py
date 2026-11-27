
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

import ai
from ai.config import env as _env
from .catalog import voice_reference, voice_vi_dir
from .tuning import VoiceTuning, default_tuning, voice_spec
from .wake import is_made_up

MAX_SPEAK_CHARS = 400


class Speech:
    def __init__(self) -> None:
        self._tts_lock = threading.Lock()
        self._tts_vi: Any = None
        self.state = "idle"
        self.error: str | None = None

    def snapshot(self) -> dict[str, str | None]:
        return {"state": self.state, "error": self.error}

    def warm(self) -> None:
        try:
            if ai.stage("tts").inprocess:
                with self._tts_lock:
                    if self._tts_vi is None:
                        self.state = "loading"
                        self._tts_vi = _load_vieneu(voice_vi_dir(), voice_reference())
            self.state = "ready"
            print("  voice    ready", flush=True)
        except Exception as error:  # noqa: BLE001
            self.state = "failed"
            self.error = str(error)
            print(f"  voice    could not warm up: {error}", flush=True)

    def transcribe(
        self,
        wav_bytes: bytes,
        locale: str,
        language: str | None = None,
        prompt: str | None = None,
        careful: bool = False,
    ) -> str:
        language = language or ("vi" if locale == "vi" else "en")
        try:
            heard = ai.transcribe(_pad_wav(_clean(_to_16k_mono(wav_bytes))), language, prompt, careful)
        except ai.AIError as error:
            self.state, self.error = "failed", str(error)
            raise RuntimeError(str(error)) from error
        self.state, self.error = "ready", None
        if is_made_up(heard):
            print(f"  stt      dropped a made-up line: {heard!r}", flush=True)
            return ""
        return heard

    def synthesize(self, text: str, locale: str, tuning: VoiceTuning | None = None) -> bytes:
        spoken = speakable(text)
        if not spoken:
            return b""
        tuning = tuning or default_tuning()
        if not ai.stage("tts").inprocess:
            try:
                return ai.speak(spoken, tuning.speed)
            except ai.AIError as error:
                raise RuntimeError(str(error)) from error
        if locale == "vi":
            return self._vieneu_vi(spoken, tuning)
        return _sapi(spoken, locale, tuning)

    def _vieneu_vi(self, spoken: str, tuning: VoiceTuning) -> bytes:
        with self._tts_lock:
            if self._tts_vi is None:
                self._tts_vi = _load_vieneu(voice_vi_dir(), voice_reference())
            audio = self._tts_vi.infer(
                text=spoken,
                voice=VOICE_NAME,
                temperature=tuning.expression,
                top_p=tuning.rhythm,
                silence_p=tuning.pause,
            )
        return _shifted_wav(audio, VIENEU_RATE, tuning)


STT_RATE = 16_000
VIENEU_RATE = 48_000
VOICE_NAME = "hino"


def _to_16k_mono(wav_bytes: bytes) -> bytes:
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


VOICE_FRAME = 512
VOICE_HOP = 256
MIN_VOICED_FRAMES = 5


def has_voice(wav_bytes: bytes) -> bool:
    import numpy as np

    try:
        with wave.open(io.BytesIO(wav_bytes)) as clip:
            if clip.getsampwidth() != 2 or clip.getnchannels() != 1:
                return True
            samples = np.frombuffer(clip.readframes(clip.getnframes()), dtype="<i2").astype(np.float32) / 32768
    except (wave.Error, EOFError):
        return True
    if samples.size < VOICE_FRAME:
        return False
    count = 1 + (samples.size - VOICE_FRAME) // VOICE_HOP
    index = np.arange(VOICE_FRAME)[None, :] + VOICE_HOP * np.arange(count)[:, None]
    frames = samples[index] * np.hanning(VOICE_FRAME)
    frames -= frames.mean(axis=1, keepdims=True)
    level = np.sqrt((frames**2).mean(axis=1))
    power = np.abs(np.fft.rfft(frames, 2 * VOICE_FRAME, axis=1)) ** 2
    repeat = np.fft.irfft(power, axis=1)[:, :VOICE_FRAME]
    repeat /= np.maximum(repeat[:, :1], 1e-12)
    low, high = STT_RATE // 400, STT_RATE // 70
    dip = np.minimum.accumulate(repeat[:, :high], axis=1)
    pitched = (repeat[:, low:high] - dip[:, low:high]).max(axis=1) > 0.5
    loud = level > max(float(np.percentile(level, 20)) * 2.0, 0.002)
    return int((pitched & loud).sum()) >= MIN_VOICED_FRAMES


MIN_STT_SECONDS = 1.5
LEAD_SECONDS = 0.35
_HISS = 130


def _pad_wav(wav_bytes: bytes) -> bytes:
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


def _load_vieneu(folder: Path, reference: Path) -> Any:
    needed = [folder / "turbo" / "denoiser.onnx", folder / "codec" / "moss_audio_tokenizer_decode_full.onnx", reference]
    missing = [path for path in needed if not path.is_file()]
    if missing:
        raise FileNotFoundError(
            f"Vietnamese voice not found: {missing[0]}. Run run.py to download it (downloads.json) or set VR_VOICE_VI_PATH."
        )
    os.environ["HF_HUB_OFFLINE"] = "1"
    from vieneu import Vieneu
    from vieneu._v3_turbo_engine import onnx_runtime_lite

    class _Engine(onnx_runtime_lite.OnnxV3LiteEngine):

        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, codec_dir=str(folder / "codec"), **kwargs)

    onnx_runtime_lite.OnnxV3LiteEngine = _Engine
    tts = Vieneu(
        mode="v3turbo",
        backbone_repo=str(folder / "turbo"),
        onnx_dir=str(folder / "turbo" / "onnx_update"),
        threads=int(_env("VR_N_THREADS") or 0),
    )
    tts.add_voice(name=VOICE_NAME, ref_audio=str(reference))
    return tts


def _shifted_wav(audio: Any, rate: int, tuning: VoiceTuning) -> bytes:
    import numpy as np

    samples = np.asarray(audio, dtype=np.float32)
    ratio = tuning.pitch_hz / voice_spec()["nativeHz"]
    stretch = tuning.speed / ratio
    if samples.size > 1 and abs(stretch - 1.0) > 0.01:
        import librosa

        samples = librosa.effects.time_stretch(samples, rate=stretch)
    return _pcm16_wav(samples, round(rate * ratio))


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
