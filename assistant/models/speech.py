"""Speech in and speech out on Core. The web sends a WAV and plays a WAV.

Listening is the `stt` stage of `ai/stages.json` (whisper.cpp on this machine, or any OpenAI-style
`/audio/transcriptions`). Speaking is the `tts` stage: with an url it is an OpenAI-style `/audio/speech`; without one it is
VieNeu-TTS v3 Turbo (ONNX, on the CPU) for Vietnamese, cloned from assistant/voices/hino.wav, and the machine's own SAPI
voice for English.
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

import ai
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
        """Load the Vietnamese voice now, in the background, so the first greeting is not a minute late."""
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
        """Speech to text. `language` overrides the locale's; `prompt` hints at the words to expect.

        `careful` searches more candidate sentences (beam search): slower, right more often. It is for what the
        wearer says to the assistant; the short checks for the wake words stay quick.
        """
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
        """Windows ships no Vietnamese SAPI voice, so Vietnamese is VieNeu cloned from the assistant's own voice."""
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


VOICE_FRAME = 512
VOICE_HOP = 256
MIN_VOICED_FRAMES = 5  # about 80 ms of a voice: a short "hino" has 8 or more, noise has none


def has_voice(wav_bytes: bytes) -> bool:
    """Is there a voice in this 16 kHz mono line, as opposed to noise, a click or a breath?

    A voice has a pitch: within a frame, the sound repeats every 2.5 to 14 ms (400 to 70 Hz).
    Noise does not, whatever its loudness. Frames are counted that are above the room's level
    and repeat like that. Whatever is not 16-bit PCM passes, as it cannot be judged.
    """
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


def _load_vieneu(folder: Path, reference: Path) -> Any:
    """VieNeu Turbo from files on disk only, with the assistant's voice enrolled from `reference`."""
    needed = [folder / "turbo" / "denoiser.onnx", folder / "codec" / "moss_audio_tokenizer_decode_full.onnx", reference]
    missing = [path for path in needed if not path.is_file()]
    if missing:
        raise FileNotFoundError(
            f"Vietnamese voice not found: {missing[0]}. Run run.py to download it (downloads.json) or set VR_VOICE_VI_PATH."
        )
    os.environ["HF_HUB_OFFLINE"] = "1"  # every file is already here; never go looking for them elsewhere
    from vieneu import Vieneu
    from vieneu._v3_turbo_engine import onnx_runtime_lite

    class _Engine(onnx_runtime_lite.OnnxV3LiteEngine):
        """The package takes the audio codec from the Hub; this points it at the folder."""

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
    """Pitch and speed apart: slow or quicken the sound first, then play it back at a shifted rate.

    Playing at `ratio` times the rate raises the pitch by `ratio` and shortens the sound by
    the same, so the sound is first stretched by `speed / ratio` to leave only `speed`.
    """
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
