"""Noise is not a question: a line with no voice in it is never handed to Whisper."""

from __future__ import annotations

import importlib
import io
import sys
import unittest
import wave

import numpy as np

from helpers import ASSISTANT, ROOT

sys.path.insert(0, str(ASSISTANT))
speech = importlib.import_module("models.speech")


def _wav(samples: np.ndarray, rate: int = 16_000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(rate)
        out.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return buffer.getvalue()


def _sample() -> tuple[np.ndarray, int]:
    with wave.open(str(ROOT / "assistant/voices/hino.wav")) as clip:
        rate = clip.getframerate()
        return np.frombuffer(clip.readframes(clip.getnframes()), dtype="<i2").astype(np.float32) / 32768, rate


class HasVoiceTest(unittest.TestCase):
    def test_noise_has_no_voice_however_loud(self) -> None:
        rng = np.random.default_rng(1)
        for amplitude in (0.003, 0.05, 0.3):
            self.assertFalse(speech.has_voice(_wav(rng.normal(0, amplitude, 16_000 * 3))), amplitude)

    def test_smoothed_and_drifting_noise_has_no_voice(self) -> None:
        rng = np.random.default_rng(2)
        smooth = np.convolve(rng.normal(0, 0.02, 48_000), np.ones(40) / 40, mode="same") * 5
        drift = np.cumsum(rng.normal(0, 0.01, 48_000))
        self.assertFalse(speech.has_voice(_wav(smooth)))
        self.assertFalse(speech.has_voice(_wav(drift / np.abs(drift).max() / 3)))

    def test_a_voice_is_heard_even_as_one_short_word(self) -> None:
        voice, rate = _sample()
        word = voice[int(1.5 * rate) : int(1.95 * rate)]
        self.assertTrue(speech.has_voice(_wav(word, rate)))

    def test_a_voice_in_noise_is_still_a_voice(self) -> None:
        voice, rate = _sample()
        rng = np.random.default_rng(3)
        noisy = voice[: rate * 3] + rng.normal(0, voice.std() / 10, rate * 3)
        self.assertTrue(speech.has_voice(_wav(noisy, rate)))

    def test_a_line_shorter_than_one_frame_is_not_a_voice(self) -> None:
        self.assertFalse(speech.has_voice(_wav(np.zeros(100))))


if __name__ == "__main__":
    unittest.main()
