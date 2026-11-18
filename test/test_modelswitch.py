"""Choosing models by voice: where a stage runs, what SiliconFlow has, and a change that waits for a yes."""

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
from urllib.parse import parse_qs, urlparse

from helpers import ASSISTANT

sys.path.insert(0, str(ASSISTANT))
cloud = importlib.import_module("models.cloud")
switch = importlib.import_module("models.modelswitch")
smith = importlib.import_module("models.pluginsmith")
engine_module = importlib.import_module("models.engine")
catalog = importlib.import_module("models.catalog")
speech_module = importlib.import_module("models.speech")
sys.path.remove(str(ASSISTANT))

CHAT = ["Qwen/Qwen2.5-7B-Instruct", "Qwen/Qwen2.5-72B-Instruct", "deepseek-ai/DeepSeek-V3", "THUDM/glm-4-9b-chat"]
SPEECH_TO_TEXT = ["FunAudioLLM/SenseVoiceSmall", "TeleAI/TeleSpeechASR"]
AUDIO = [*SPEECH_TO_TEXT, "FunAudioLLM/CosyVoice2-0.5B", "fishaudio/fish-speech-1.5"]
ASKED: list[str] = []


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass

    def do_GET(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        query = parse_qs(url.query)
        ASKED.append(self.path)
        if url.path != "/models" or self.headers.get("Authorization") != "Bearer sk-test":
            self.send_error(401)
            return
        ids = CHAT if query.get("sub_type") == ["chat"] else SPEECH_TO_TEXT if query.get("sub_type") == ["speech-to-text"] else AUDIO
        data = json.dumps({"object": "list", "data": [{"id": item, "object": "model"} for item in ids]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class ModelSwitchTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = HTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()

    def setUp(self) -> None:
        self.saved = {k: v for k, v in os.environ.items() if k.startswith("VR_") or k.startswith("SILICONFLOW")}
        for key in self.saved:
            os.environ.pop(key, None)
        os.environ["VR_SILICONFLOW_KEY"] = "sk-test"
        os.environ["VR_SILICONFLOW_URL"] = f"http://127.0.0.1:{self.server.server_port}"
        cloud.reset()
        switch.reset()
        smith.set_source("local")
        ASKED.clear()

    def tearDown(self) -> None:
        for key in [k for k in os.environ if k.startswith("VR_") or k.startswith("SILICONFLOW")]:
            os.environ.pop(key, None)
        os.environ.update(self.saved)
        cloud.reset()
        switch.reset()
        smith.set_source("local")

    def say(self, line: str, locale: str = "vi") -> str | None:
        out = switch.command(line, locale)
        return None if out is None else out["reply"]

    # where a stage runs

    def test_a_stage_is_switched_to_the_api_and_back(self) -> None:
        self.assertIn("API", self.say("dùng API để trả lời"))
        self.assertTrue(cloud.wants("chat"))
        self.assertIn("trên máy", self.say("trả lời bằng local"))
        self.assertFalse(cloud.wants("chat"))

    def test_the_other_stages_follow_their_own_names(self) -> None:
        self.say("use the API for listening", "en")
        self.say("use the API for speaking", "en")
        self.assertTrue(cloud.wants("stt", "en") and cloud.wants("tts", "en"))
        self.assertFalse(cloud.wants("chat"))
        self.say("dùng API để viết code")
        self.assertEqual(smith.source(), "api")

    def test_speech_in_vietnamese_is_said_to_stay_on_the_machine(self) -> None:
        self.assertIn("Tiếng Việt vẫn chạy trên máy", self.say("dùng API để nghe"))
        self.assertFalse(cloud.wants("stt", "vi"))

    def test_without_a_key_nothing_changes_and_it_says_so(self) -> None:
        del os.environ["VR_SILICONFLOW_KEY"]
        self.assertIn("Chưa có khoá", self.say("dùng API để trả lời"))
        self.assertFalse(cloud.wants("chat"))

    def test_a_bare_request_asks_which_stage(self) -> None:
        self.assertIn("việc nào", self.say("dùng API"))
        self.assertIsNone(self.say("dùng API cho mấy cái bài tập về nhà của tôi hôm nay nhé"))

    def test_the_menu_has_no_local_model(self) -> None:
        self.assertIn("chỉ chạy với API", self.say("điều khiển menu bằng local"))

    # what there is

    def test_the_models_on_offer_are_read_out(self) -> None:
        reply = self.say("có những model nào để trả lời")
        self.assertIn("4 model", reply)
        self.assertIn("Qwen2.5-7B-Instruct", reply)
        self.assertNotIn("Qwen/", reply)  # the maker's prefix is not read aloud

    def test_a_name_narrows_the_list(self) -> None:
        reply = self.say("model qwen 72b nào")
        self.assertIn("1 model", reply)
        self.assertIn("Qwen2.5-72B-Instruct", reply)

    def test_each_stage_asks_for_its_own_kind(self) -> None:
        self.say("có những model nào để nghe")
        self.say("có những model nào để đọc")
        self.assertTrue(any("sub_type=speech-to-text" in path for path in ASKED))
        self.assertTrue(any("type=audio" in path for path in ASKED))
        self.assertIn("CosyVoice2", self.say("có những model nào để đọc"))
        self.assertNotIn("SenseVoice", self.say("có những model nào để đọc"))  # those listen, they do not speak

    def test_without_a_key_it_cannot_look_up(self) -> None:
        del os.environ["VR_SILICONFLOW_KEY"]
        self.assertIn("chưa tra được", self.say("có những model nào"))

    # which one

    def test_a_change_waits_for_a_yes_and_then_happens(self) -> None:
        ask = self.say("đổi model trả lời sang qwen 72b")
        self.assertIn("Qwen2.5-72B-Instruct", ask)
        self.assertIn("đúng không", ask)
        self.assertEqual(cloud.model("VR_LLM_MODEL"), cloud.DEFAULT_MODELS["VR_LLM_MODEL"])  # nothing yet
        done = self.say("đúng rồi")
        self.assertIn("Đã đổi model trả lời", done)
        self.assertEqual(cloud.model("VR_LLM_MODEL"), "Qwen/Qwen2.5-72B-Instruct")
        self.assertEqual(cloud.model("VR_CODE_MODEL"), "Qwen/Qwen2.5-72B-Instruct")  # follows the one model

    def test_a_no_leaves_the_model_as_it_was(self) -> None:
        self.say("đổi model trả lời sang deepseek")
        self.assertIn("giữ nguyên", self.say("không"))
        self.assertEqual(cloud.model("VR_LLM_MODEL"), cloud.DEFAULT_MODELS["VR_LLM_MODEL"])

    def test_something_else_drops_the_question(self) -> None:
        self.say("đổi model trả lời sang deepseek")
        self.assertIsNone(self.say("mấy giờ rồi"))
        self.assertIsNone(self.say("đúng rồi"))  # nothing is waiting any more
        self.assertEqual(cloud.model("VR_LLM_MODEL"), cloud.DEFAULT_MODELS["VR_LLM_MODEL"])

    def test_a_request_is_not_taken_for_a_yes(self) -> None:
        self.say("đổi model trả lời sang deepseek")
        self.say("dùng API để nghe")  # "dùng" sounds like "đúng" once accents go
        self.assertEqual(cloud.model("VR_LLM_MODEL"), cloud.DEFAULT_MODELS["VR_LLM_MODEL"])

    def test_a_name_that_is_not_on_the_list_changes_nothing(self) -> None:
        self.assertIn("không thấy model nào", self.say("đổi model trả lời sang gpt năm"))
        self.assertIsNone(self.say("đúng rồi"))

    def test_a_model_can_be_set_for_one_job_only(self) -> None:
        self.say("đổi model viết plugin sang deepseek")
        self.say("đúng")
        self.assertEqual(cloud.model("VR_CODE_MODEL"), "deepseek-ai/DeepSeek-V3")
        self.assertEqual(cloud.model("VR_LLM_MODEL"), cloud.DEFAULT_MODELS["VR_LLM_MODEL"])

    def test_a_chosen_model_on_a_stage_that_runs_here_says_it_will_not_be_used_yet(self) -> None:
        self.say("đổi model trả lời sang qwen 72b")
        self.assertIn("đang chạy trên máy", self.say("đúng"))

    def test_ordinary_lines_are_left_alone(self) -> None:
        for line in ("mấy giờ rồi", "hôm nay trời đẹp không", "what is the capital of France", "tắt chẩn đoán"):
            self.assertIsNone(self.say(line), line)

    def test_nothing_chosen_by_voice_outlives_the_server(self) -> None:
        self.say("dùng API để trả lời")
        cloud.reset()  # what a restart does: the voice choices are only in memory
        self.assertFalse(cloud.wants("chat"))

    # on the screen

    def test_the_setup_is_put_on_the_screen_and_the_voice_says_one_line(self) -> None:
        out = switch.command("hiện thông tin model", "vi")
        self.assertEqual(out["open"], "assistant")
        self.assertIn("Cấu hình trợ lý", out["display"])
        for label in ("Trả lời:", "Viết plugin:", "Điều khiển menu:", "Nghe:", "Đọc:"):
            self.assertIn(label, out["display"])
        self.assertNotIn("Qwen", out["reply"])  # the voice does not read the table
        self.assertLess(len(out["reply"]), 80)

    def test_the_setup_follows_what_was_chosen(self) -> None:
        self.say("dùng API để trả lời")
        self.say("đổi model trả lời sang qwen 72b")
        self.say("đúng")
        shown = switch.command("model nào đang dùng", "vi")["display"]
        self.assertIn("Trả lời: API · Qwen/Qwen2.5-72B-Instruct", shown)
        self.assertIn("Viết plugin: máy", shown)
        self.assertIn("Khoá SiliconFlow: có", shown)

    def test_the_setup_says_the_key_is_missing(self) -> None:
        del os.environ["VR_SILICONFLOW_KEY"]
        self.assertIn("Khoá SiliconFlow: chưa có", switch.command("cho tôi xem cấu hình trợ lý", "vi")["display"])

    def test_the_whole_list_is_shown_while_only_a_few_are_read(self) -> None:
        out = switch.command("có những model nào để trả lời", "vi")
        self.assertEqual(out["open"], "assistant")
        self.assertEqual(out["display"].count("•"), len(CHAT))
        self.assertIn("(4)", out["display"])

    def test_a_change_to_confirm_shows_the_full_id(self) -> None:
        out = switch.command("đổi model trả lời sang qwen 72b", "vi")
        self.assertIn("Qwen/Qwen2.5-72B-Instruct", out["display"])
        self.assertEqual(out["open"], "assistant")

    def test_a_switch_that_happened_shows_the_new_setup(self) -> None:
        out = switch.command("dùng API để trả lời", "vi")
        self.assertIn("Trả lời: API", out["display"])

    def test_a_refusal_does_not_open_the_page(self) -> None:
        del os.environ["VR_SILICONFLOW_KEY"]
        self.assertNotIn("open", switch.command("dùng API để trả lời", "vi"))
        self.assertNotIn("open", switch.command("có những model nào", "vi"))

    def test_the_english_setup_reads_in_english(self) -> None:
        out = switch.command("show the model info", "en")
        self.assertIn("Assistant setup", out["display"])
        self.assertIn("Answering:", out["display"])


class EventsTest(unittest.TestCase):
    """What the page receives: the page opens first, then the whole text, then speech of the short line."""

    def setUp(self) -> None:
        self.saved = {k: v for k, v in os.environ.items() if k.startswith("VR_") or k.startswith("SILICONFLOW")}
        for key in self.saved:
            os.environ.pop(key, None)
        os.environ["VR_SILICONFLOW_KEY"] = "sk-test"
        cloud.reset()
        switch.reset()
        smith.set_source("local")
        self.engine = engine_module.Engine()
        self.spec = catalog.ModelSpec(id="t", gguf="nowhere.gguf")
        self.engine._spec, self.engine.state = self.spec, "ready"
        self.engine._model = object()
        self.engine._ensure_speech = lambda: None
        self.spoken: list[str] = []
        self.keep = (speech_module.speech.transcribe, engine_module._tts)
        speech_module.speech.transcribe = lambda *a, **k: "hiện thông tin model"
        engine_module._tts = lambda text, locale, tuning: self.spoken.append(text)

    def tearDown(self) -> None:
        speech_module.speech.transcribe, engine_module._tts = self.keep
        for key in [k for k in os.environ if k.startswith("VR_") or k.startswith("SILICONFLOW")]:
            os.environ.pop(key, None)
        os.environ.update(self.saved)
        cloud.reset()
        switch.reset()

    def test_the_page_opens_and_the_whole_text_is_sent_but_only_the_short_line_is_spoken(self) -> None:
        with contextlib.redirect_stdout(io.StringIO()):  # the server logs what it heard; a console may not take accents
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
