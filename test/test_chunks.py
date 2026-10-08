"""The reply is spoken a sentence at a time, while the model is still writing."""

from __future__ import annotations

import importlib.util
import unittest

from helpers import ASSISTANT, SRC


def _load():
    spec = importlib.util.spec_from_file_location("chunks_under_test", ASSISTANT / "models/chunks.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.next_chunk


next_chunk = _load()


class ChunkingTest(unittest.TestCase):
    def test_a_sentence_is_ready_once_whitespace_follows_its_full_stop(self) -> None:
        self.assertEqual(next_chunk("Xin chào bạn. Tôi", False), ("Xin chào bạn.", "Tôi"))
        self.assertIsNone(next_chunk("Xin chào bạn.", False))

    def test_a_decimal_point_is_not_the_end_of_a_sentence(self) -> None:
        self.assertIsNone(next_chunk("Nhiệt độ 25.5 độ", False))

    def test_a_question_and_a_line_break_end_a_piece(self) -> None:
        self.assertEqual(next_chunk("Bạn khỏe không? Mình", False), ("Bạn khỏe không?", "Mình"))
        self.assertEqual(next_chunk("Một dòng\nHai", False), ("Một dòng", "Hai"))

    def test_only_the_first_piece_may_end_at_a_comma(self) -> None:
        text = "Hôm nay trời đẹp lắm, mình nên đi dạo một lát nhé"
        self.assertEqual(next_chunk(text, True), ("Hôm nay trời đẹp lắm,", "mình nên đi dạo một lát nhé"))
        self.assertIsNone(next_chunk(text, False))

    def test_a_short_clause_waits_for_more(self) -> None:
        self.assertIsNone(next_chunk("Xin chào, bạn", True))

    def test_a_reply_that_never_stops_is_cut_at_a_space(self) -> None:
        text = "từ " * 100
        piece, rest = next_chunk(text, False)
        self.assertLessEqual(len(piece), 200)
        self.assertEqual((piece + " " + rest).split(), text.split())


class PlaybackTest(unittest.TestCase):
    def test_the_player_is_a_queue_and_the_bridge_feeds_it_as_sentences_arrive(self) -> None:
        player = (SRC / "core/audio/SpeechPlayer.ts").read_text(encoding="utf-8")
        bridge = (SRC / "core/models/ModelBridge.ts").read_text(encoding="utf-8")
        client = (SRC / "core/models/ModelClient.ts").read_text(encoding="utf-8")
        self.assertIn("enqueue(", player)
        self.assertIn("idle(", player)
        self.assertEqual(bridge.count("this.audioSink(abort)"), 3)  # wake, ask, talk
        self.assertEqual(client.count("onAudio?: (audio: Blob) => void,"), 3)  # complete, wake, talk
        self.assertIn("handlers.onAudio?.(piece)", client)

    def test_a_turn_ends_when_the_speaker_goes_quiet_not_when_the_text_does(self) -> None:
        bridge = (SRC / "core/models/ModelBridge.ts").read_text(encoding="utf-8")
        self.assertEqual(bridge.count("await this.player.idle()"), 3)
