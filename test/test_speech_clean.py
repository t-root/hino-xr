"""A quiet or rumbling microphone is put right before Whisper reads it."""

from __future__ import annotations

import importlib
import io
import math
import struct
import sys
import unittest
import wave

import numpy as np

from helpers import ASSISTANT

sys.path.insert(0, str(ASSISTANT))
speech = importlib.import_module("models.speech")
sys.path.remove(str(ASSISTANT))

RATE = 16_000


def wav(samples: list[int]) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(RATE)
        out.writeframes(b"".join(struct.pack("<h", value) for value in samples))
    return buffer.getvalue()


def read(data: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(data)) as clip:
        return np.frombuffer(clip.readframes(clip.getnframes()), dtype="<i2")


def tone(seconds: float, amplitude: float, period: float = 9.0) -> list[int]:
    return [int(amplitude * math.sin(i / period)) for i in range(int(seconds * RATE))]


class CleanTest(unittest.TestCase):
    def test_a_quiet_voice_is_raised(self) -> None:
        quiet = wav([0] * RATE + tone(1, 1500) + [0] * RATE)
        out = read(speech._clean(quiet))
        self.assertGreater(int(np.abs(out).max()), 3 * 1500)

    def test_silence_around_the_voice_is_trimmed_but_not_all_of_it(self) -> None:
        out = read(speech._clean(wav([0] * (2 * RATE) + tone(1, 8000) + [0] * (2 * RATE))))
        seconds = len(out) / RATE
        self.assertLess(seconds, 2.0)
        self.assertGreater(seconds, 1.2)

    def test_low_rumble_is_taken_out(self) -> None:
        rumble = [int(6000 * math.sin(i / 400)) for i in range(2 * RATE)]
        out = read(speech._clean(wav(rumble))).astype(np.float32)
        self.assertLess(float(np.abs(out).mean()), float(np.abs(np.array(rumble)).mean()) * 0.5)

    def test_hiss_is_not_made_into_speech(self) -> None:
        hiss = [int(3 * math.sin(i)) for i in range(RATE)]
        out = read(speech._clean(wav(hiss)))
        self.assertLess(int(np.abs(out).max()), 2000)

    def test_other_formats_pass_through_untouched(self) -> None:
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as out:
            out.setnchannels(1)
            out.setsampwidth(2)
            out.setframerate(48_000)
            out.writeframes(b"\x00\x01" * 1000)
        self.assertEqual(speech._clean(buffer.getvalue()), buffer.getvalue())


if __name__ == "__main__":
    unittest.main()
