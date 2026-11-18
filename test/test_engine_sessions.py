"""Answering a question and writing a plugin are two sessions of one model: neither waits for the other."""

from __future__ import annotations

import importlib
import sys
import threading
import unittest

from helpers import ASSISTANT

sys.path.insert(0, str(ASSISTANT))
engine_module = importlib.import_module("models.engine")
catalog = importlib.import_module("models.catalog")
sys.path.remove(str(ASSISTANT))


class FakeSession:
    """Stands in for a llama.cpp session: says its name, and can be made to hold still half way."""

    def __init__(self, name: str, hold: threading.Event | None = None, started: threading.Event | None = None) -> None:
        self.name, self.hold, self.started = name, hold, started

    def create_chat_completion(self, **kwargs):
        def chunks():
            yield {"choices": [{"delta": {"content": self.name}}]}
            if self.started:
                self.started.set()
            if self.hold:
                self.hold.wait(10)
            yield {"choices": [{"delta": {"content": "!"}}]}

        return chunks()


class SessionsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.spec = catalog.ModelSpec(id="t", gguf="nowhere.gguf")
        self.engine = engine_module.Engine()
        self.engine._spec, self.engine.state = self.spec, "ready"
        self.engine._ensure_speech = lambda: None  # no voice weights in a test

    def test_a_question_is_answered_while_a_plugin_is_being_written(self) -> None:
        hold, started = threading.Event(), threading.Event()
        self.engine._model = FakeSession("chat")
        self.engine._code_model = FakeSession("code", hold, started)
        writing: list[str] = []

        def write() -> None:
            writing.extend(self.engine.generate(self.spec, [{"role": "user", "content": "x"}], 50, "en", session="code"))

        thread = threading.Thread(target=write)
        thread.start()
        self.assertTrue(started.wait(5), "the code session never started")
        answer = "".join(self.engine.generate(self.spec, [{"role": "user", "content": "hi"}], 50, "en"))
        self.assertEqual(answer, "chat!")  # the code session is still holding still
        self.assertEqual(writing, ["code"])
        hold.set()
        thread.join(5)
        self.assertEqual("".join(writing), "code!")

    def test_the_code_session_is_made_once_and_only_when_needed(self) -> None:
        made: list[int] = []
        self.engine._llama = lambda spec, threads, n_ctx: made.append(threads) or FakeSession("code")
        self.assertEqual(made, [])
        for _ in range(2):
            "".join(self.engine.generate(self.spec, [{"role": "user", "content": "x"}], 50, "en", session="code"))
        self.assertEqual(len(made), 1)

    def test_the_code_session_gets_a_share_of_the_threads(self) -> None:
        import os

        keep = {k: os.environ.get(k) for k in ("VR_N_THREADS", "VR_N_THREADS_CODE")}
        try:
            os.environ["VR_N_THREADS"] = "9"
            os.environ.pop("VR_N_THREADS_CODE", None)
            seen: list[int] = []
            self.engine._llama = lambda spec, threads, n_ctx: seen.append(threads) or FakeSession("code")
            self.engine._code_session(self.spec)
            self.assertEqual(seen, [3])
        finally:
            for key, value in keep.items():
                os.environ.pop(key, None)
                if value is not None:
                    os.environ[key] = value



class PipelineTest(unittest.TestCase):
    """The voice is made on its own thread: the model goes on writing while a sentence is being spoken."""

    def setUp(self) -> None:
        import contextlib
        import io

        self.engine = engine_module.Engine()
        self.spec = catalog.ModelSpec(id="t", gguf="nowhere.gguf")
        self.keep = engine_module._tts
        self.out = contextlib.redirect_stdout(io.StringIO())
        self.out.__enter__()

    def tearDown(self) -> None:
        engine_module._tts = self.keep
        self.out.__exit__(None, None, None)

    def test_tokens_are_not_held_up_by_the_voice(self) -> None:
        import time

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
        timing = importlib.import_module("models.timing")
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
