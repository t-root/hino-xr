"""PCM WAV packing matches the header the assistant expects."""

from __future__ import annotations

import struct
import unittest

from helpers import SRC


def encode_wav(samples: list[float], sample_rate: int) -> bytes:
    rate = max(1, round(sample_rate))
    count = len(samples)
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        36 + count * 2,
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        rate,
        rate * 2,
        2,
        16,
        b"data",
        count * 2,
    )
    body = bytearray()
    for sample in samples:
        clipped = max(-1.0, min(1.0, sample))
        body.extend(struct.pack("<h", int(clipped * 0x8000 if clipped < 0 else clipped * 0x7FFF)))
    return header + bytes(body)


class WavHeaderTest(unittest.TestCase):
    def test_mono_pcm_header(self) -> None:
        samples = [0.0, 0.5, -0.5, 1.0]
        data = encode_wav(samples, 16_000)
        self.assertTrue(data.startswith(b"RIFF"))
        self.assertEqual(data[8:12], b"WAVE")
        channels = struct.unpack_from("<H", data, 22)[0]
        rate = struct.unpack_from("<I", data, 24)[0]
        bits = struct.unpack_from("<H", data, 34)[0]
        self.assertEqual(channels, 1)
        self.assertEqual(rate, 16_000)
        self.assertEqual(bits, 16)
        self.assertEqual(len(data), 44 + len(samples) * 2)

    def test_browser_encoder_writes_the_same_header_fields(self) -> None:
        source = (SRC / "core/audio/wav.ts").read_text(encoding="utf-8")
        self.assertIn('"RIFF"', source)
        self.assertIn('"WAVE"', source)
        self.assertIn("setUint16(22, 1, true)", source)
        self.assertIn("setUint16(34, 16, true)", source)
        self.assertIn("audio/wav", source)
