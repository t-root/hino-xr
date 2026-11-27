
from __future__ import annotations

import contextlib
import importlib
import io
import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from helpers import ASSISTANT

sys.path.insert(0, str(ASSISTANT))
ai = importlib.import_module("ai")
switch = importlib.import_module("models.modelswitch")
engine_module = importlib.import_module("models.engine")
catalog = importlib.import_module("models.catalog")
speech_module = importlib.import_module("models.speech")
sys.path.remove(str(ASSISTANT))

MODELS = ["Qwen/Qwen2.5-7B-Instruct", "Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V3", "THUDM/glm-4-9b-chat"]


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/v1/models" or self.headers.get("Authorization") != "Bearer sk-test":
            self.send_error(401)
            return
        data = json.dumps({"object": "list", "data": [{"id": item, "object": "model"} for item in MODELS]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class Env(unittest.TestCase):
    def setUp(self) -> None:
        self.saved = {k: v for k, v in os.environ.items() if k.startswith("VR_")}
        for key in self.saved:
            os.environ.pop(key, None)
        ai.config.reset()
        switch.reset()

    def tearDown(self) -> None:
        for key in [k for k in os.environ if k.startswith("VR_")]:
            os.environ.pop(key, None)
        os.environ.update(self.saved)
        ai.config.reset()
        switch.reset()


class ModelSwitchTest(Env):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = HTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/v1"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()

    def outside(self) -> None:
        os.environ.update(VR_CHAT_URL=self.url, VR_CHAT_KEY="sk-test", VR_CHAT_MODEL="Qwen/Qwen2.5-7B-Instruct")
        ai.config.reset()

    def say(self, line: str, locale: str = "vi") -> str | None:
        out = switch.command(line, locale)
        return None if out is None else out["reply"]


    def test_the_models_on_offer_are_read_out(self) -> None:
        self.outside()
        reply = self.say("có những model nào để trả lời")
        self.assertIn("4 model", reply)
        self.assertIn("trả lời", reply)
        self.assertNotIn("Qwen/", reply)

    def test_a_name_narrows_the_list(self) -> None:
        self.outside()
        self.assertIn("2 model", self.say("model qwen nào để trả lời"))
        self.assertIn("1 model", self.say("model deepseek nào"))

    def test_a_list_that_cannot_be_read_says_so(self) -> None:
        os.environ["VR_CHAT_URL"] = "http://127.0.0.1:1/v1"
        self.assertIn("chưa tra được", self.say("có những model nào để trả lời"))


    def test_a_change_waits_for_a_yes_and_then_happens(self) -> None:
        self.outside()
        ask = self.say("đổi model trả lời sang qwen 72b")
        self.assertIn("72B-Instruct", ask)
        self.assertEqual(ai.stage("chat").model, "Qwen/Qwen2.5-7B-Instruct")
        self.assertIn("Đã đổi", self.say("đúng rồi"))
        self.assertEqual(ai.stage("chat").model, "Qwen/Qwen2.5-72B-Instruct")
        self.assertEqual(ai.stage("agent").model, "Qwen/Qwen2.5-72B-Instruct")

    def test_a_no_leaves_the_model_as_it_was(self) -> None:
        self.outside()
        self.say("đổi model trả lời sang qwen 72b")
        self.assertIn("giữ nguyên", self.say("không"))
        self.assertEqual(ai.stage("chat").model, "Qwen/Qwen2.5-7B-Instruct")

    def test_something_else_drops_the_question(self) -> None:
        self.outside()
        self.say("đổi model trả lời sang qwen 72b")
        self.assertIsNone(self.say("mấy giờ rồi"))
        self.assertIsNone(self.say("đúng rồi"))
        self.assertEqual(ai.stage("chat").model, "Qwen/Qwen2.5-7B-Instruct")

    def test_a_name_that_is_not_on_the_list_changes_nothing(self) -> None:
        self.outside()
        self.assertIn("không thấy", self.say("đổi model trả lời sang llama 405b"))
        self.assertIsNone(self.say("đúng rồi"))

    def test_a_stage_that_runs_here_is_not_changed_by_voice(self) -> None:
        reply = self.say("đổi model trả lời sang qwen 72b")
        self.assertIn("stages.json", reply)
        self.assertIsNone(self.say("đúng rồi"))

    def test_ordinary_lines_are_left_alone(self) -> None:
        for line in ("mấy giờ rồi", "dùng API để trả lời", "hôm nay trời đẹp"):
            self.assertIsNone(self.say(line), line)

    def test_nothing_chosen_by_voice_outlives_the_server(self) -> None:
        self.outside()
        self.say("đổi model trả lời sang qwen 72b")
        self.say("đúng")
        ai.config.reset()
        switch.reset()
        self.assertEqual(ai.stage("chat").model, "Qwen/Qwen2.5-7B-Instruct")


    def test_the_setup_is_put_on_the_screen_and_the_voice_says_one_line(self) -> None:
        out = switch.command("hiện thông tin model", "vi")
        self.assertEqual(out["reply"], "Mình đang hiện cấu hình trợ lý trên màn hình.")
        self.assertEqual(out["open"], "assistant")
        self.assertIn(f"Trả lời: máy này · {ai.stage('chat').model}", out["display"])
        self.assertIn("Nhìn màn hình: máy này", out["display"])
        self.assertIn(f"Viết plugin: máy này · {ai.stage('code').model}", out["display"])
        self.assertIn("VieNeu", out["display"])
        self.assertIn("Plugin hỏi đáp", out["display"])

    def test_the_setup_says_which_stage_went_to_an_api(self) -> None:
        self.outside()
        card = switch.status("vi")
        self.assertIn("Trả lời: API ngoài · Qwen/Qwen2.5-7B-Instruct", card)
        self.assertIn("Nhìn màn hình: API ngoài", card)
        self.assertIn("Viết plugin: máy này", card)

    def test_the_english_setup_reads_in_english(self) -> None:
        out = switch.command("show the model info", "en")
        self.assertEqual(out["reply"], "I am showing the assistant's setup on the screen.")
        self.assertIn("Assistant setup", out["display"])
        self.assertIn("Answering: this machine", out["display"])

    def test_the_whole_list_is_shown_while_only_a_few_are_read(self) -> None:
        self.outside()
        out = switch.command("có những model nào để trả lời", "vi")
        self.assertEqual(out["display"].count("•"), 4)
        self.assertLessEqual(out["reply"].count(","), switch.MAX_READ)

    def test_a_change_to_confirm_shows_the_full_id(self) -> None:
        self.outside()
        out = switch.command("đổi model trả lời sang qwen 72b", "vi")
        self.assertIn("Qwen/Qwen2.5-72B-Instruct", out["display"])
        self.assertEqual(out["open"], "assistant")

    def test_a_refusal_does_not_open_the_page(self) -> None:
        self.outside()
        self.assertNotIn("open", switch.command("đổi model trả lời sang llama 405b", "vi"))


class EventsTest(Env):

    def setUp(self) -> None:
        super().setUp()
        self.engine = engine_module.Engine()
        self.spec = catalog.ModelSpec(id="t")
        self.engine._spec, self.engine.state = self.spec, "ready"
        self.keep_ready = engine_module.ai.ready
        engine_module.ai.ready = lambda name: None
        self.spoken: list[str] = []
        self.keep = (speech_module.speech.transcribe, engine_module._tts)
        speech_module.speech.transcribe = lambda *a, **k: "hiện thông tin model"
        engine_module._tts = lambda text, locale, tuning: self.spoken.append(text)

    def tearDown(self) -> None:
        speech_module.speech.transcribe, engine_module._tts = self.keep
        engine_module.ai.ready = self.keep_ready
        super().tearDown()

    def test_the_page_opens_and_the_whole_text_is_sent_but_only_the_short_line_is_spoken(self) -> None:
        with contextlib.redirect_stdout(io.StringIO()):
            events = list(self.engine.talk(self.spec, b"wav", "vi"))
        kinds = [(e["type"], e.get("id")) for e in events if e["type"] in {"command", "token"}]
        self.assertEqual(kinds, [("command", None), ("command", "page.assistant"), ("token", None)])
        opening = events[2]
        self.assertEqual((opening["action"], opening["value"]), ("setting", True))
        shown = next(e["text"] for e in events if e["type"] == "token")
        self.assertIn("Cấu hình trợ lý", shown)
        self.assertEqual(self.spoken, ["Mình đang hiện cấu hình trợ lý trên màn hình."])


if __name__ == "__main__":
    unittest.main()
