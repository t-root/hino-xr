"""A turn of the assistant: the answer comes from the `chat` stage, and the voice is made on its own thread."""

from __future__ import annotations

import contextlib
import importlib
import io
import sys
import time
import unittest

from helpers import ASSISTANT

sys.path.insert(0, str(ASSISTANT))
engine_module = importlib.import_module("models.engine")
catalog = importlib.import_module("models.catalog")
timing = importlib.import_module("models.timing")
sys.path.remove(str(ASSISTANT))


class AnswerTest(unittest.TestCase):
    """What the engine asks of the stage, and what it does when the stage fails."""

    def setUp(self) -> None:
        self.engine = engine_module.Engine()
        self.spec = catalog.ModelSpec(id="t")
        self.ai = engine_module.ai
        self.keep = (self.ai.ready, self.ai.chat_stream)
        self.asked: list[tuple] = []
        self.ai.ready = lambda name: None

    def tearDown(self) -> None:
        self.ai.ready, self.ai.chat_stream = self.keep

    def test_the_question_goes_to_the_chat_stage_with_the_system_line_first(self) -> None:
        def stream(name, messages, max_tokens, temperature):
            self.asked.append((name, [m["role"] for m in messages], max_tokens))
            yield "Xin "
            yield "chào"

        self.ai.chat_stream = stream
        text = "".join(self.engine.generate(self.spec, [{"role": "user", "content": "hi"}], 9999, "en"))
        self.assertEqual(text, "Xin chào")
        self.assertEqual(self.asked, [("chat", ["system", "user"], 512)])  # the length is capped
        self.assertEqual(self.engine.state, "ready")

    def test_a_failed_stage_is_a_failed_state_and_a_RuntimeError(self) -> None:
        def stream(*args):
            raise self.ai.AIError("chat: /chat/completions failed")
            yield  # pragma: no cover

        self.ai.chat_stream = stream
        with self.assertRaises(RuntimeError):
            list(self.engine.generate(self.spec, [{"role": "user", "content": "hi"}], 50, "en"))
        self.assertEqual(self.engine.state, "failed")
        self.assertIn("chat", self.engine.error)

    def test_a_server_that_will_not_start_fails_the_load(self) -> None:
        def ready(name):
            raise self.ai.AIError("chat: llama-server.exe is not in assistant/bin/llama: run run.py to download it")

        self.ai.ready = ready
        with self.assertRaises(RuntimeError) as caught:
            self.engine.load(self.spec)
        self.assertIn("run.py", str(caught.exception))
        self.assertEqual(self.engine.snapshot(self.spec)["state"], "failed")

    def test_the_snapshot_says_where_the_answers_come_from(self) -> None:
        self.engine.load(self.spec)
        shot = self.engine.snapshot(self.spec)
        self.assertEqual((shot["state"], shot["device"]), ("ready", "local"))
        self.assertIsNone(self.engine.snapshot(catalog.ModelSpec(id="other"))["device"])

    def test_the_old_id_the_page_saved_still_means_the_assistant(self) -> None:
        self.assertEqual(engine_module.resolve("qwen-2.5-3b").id, "assistant")
        with self.assertRaises(KeyError):
            engine_module.resolve("nonsense")


class PipelineTest(unittest.TestCase):
    """The voice is made on its own thread: the model goes on writing while a sentence is being spoken."""

    def setUp(self) -> None:
        self.engine = engine_module.Engine()
        self.spec = catalog.ModelSpec(id="t")
        self.keep = engine_module._tts
        self.out = contextlib.redirect_stdout(io.StringIO())
        self.out.__enter__()

    def tearDown(self) -> None:
        engine_module._tts = self.keep
        self.out.__exit__(None, None, None)

    def test_tokens_are_not_held_up_by_the_voice(self) -> None:
        times: list[float] = []

        def slow_voice(text, locale, tuning):
            time.sleep(0.3)
            return {"type": "audio", "text": text}

        def words(*args, **kwargs):
            for piece in ("Xin chào bạn thân mến. ", "Hôm nay trời đẹp lắm bạn ơi. ", "Mình rất vui được gặp bạn. "):
                yield piece

        self.engine.generate = words
        engine_module._tts = slow_voice
        start = time.monotonic()
        events = []
        for event in self.engine.reply(self.spec, [{"role": "user", "content": "hi"}], 100, True, "vi"):
            events.append(event)
            if event["type"] == "token":
                times.append(time.monotonic() - start)
        audio = [e for e in events if e["type"] == "audio"]
        self.assertEqual(len(audio), 3)  # every sentence is spoken, in order
        self.assertEqual([e["text"].strip()[:3] for e in audio], ["Xin", "Hôm", "Mìn"])
        self.assertLess(times[-1], 0.25)  # the last token came before the first sentence was even spoken

    def test_a_turn_leaves_its_timings(self) -> None:
        timing.begin()
        with timing.measure("listen"):
            pass
        timing.tokens(10, 0.5, 1.0)
        with timing.measure("speak"):
            pass
        timing.finish()
        said = timing.summary("vi")
        self.assertIn("nghe", said)
        self.assertIn("10.0 token/giây", said)
        self.assertIn("listen", timing.line(timing.last))


if __name__ == "__main__":
    unittest.main()
