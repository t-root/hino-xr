"""Asking about the picture in front of the camera: what is it, read it, translate it. Local or API, the same answer shape."""

from __future__ import annotations

import asyncio
import base64
import importlib
import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from helpers import ASSISTANT, SRC

sys.path.insert(0, str(ASSISTANT))
vision = importlib.import_module("models.vision")
cloud = importlib.import_module("models.cloud")
sight = importlib.import_module("models.sight_speech")
switch = importlib.import_module("models.modelswitch")
server_app = importlib.import_module("app")
sys.path.remove(str(ASSISTANT))

JPEG = b"\xff\xd8\xff\xe0fakejpeg"
SEEN: dict = {}


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass

    def do_POST(self) -> None:  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        SEEN.update(path=self.path, body=body, auth=self.headers.get("Authorization"))
        data = json.dumps({"choices": [{"message": {"content": "Đây là một quả táo. Nó màu đỏ."}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class VisionTest(unittest.TestCase):
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
        os.environ["VR_VISION_MODEL_PATH"] = "nowhere/model.gguf"  # the local model is not on this machine
        os.environ["VR_VISION_MMPROJ_PATH"] = "nowhere/mmproj.gguf"
        cloud.reset()
        vision._session = None
        self.real_files = vision.local_files
        SEEN.clear()

    def tearDown(self) -> None:
        for key in [k for k in os.environ if k.startswith("VR_") or k.startswith("SILICONFLOW")]:
            os.environ.pop(key, None)
        os.environ.update(self.saved)
        cloud.reset()
        vision._session = None
        vision.local_files = self.real_files

    # the API

    def test_the_api_gets_the_picture_and_the_question(self) -> None:
        os.environ["VR_VISION_SOURCE"] = "api"
        out = vision.ask(JPEG, "ask", "cái này là gì", "vi")
        sent = SEEN["body"]
        self.assertEqual(sent["model"], cloud.DEFAULT_MODELS["VR_VISION_MODEL"])
        parts = sent["messages"][0]["content"]
        self.assertTrue(parts[0]["image_url"]["url"].startswith("data:image/jpeg;base64,"))
        self.assertEqual(base64.b64decode(parts[0]["image_url"]["url"].split(",", 1)[1]), JPEG)
        self.assertIn("cái này là gì", parts[1]["text"])
        self.assertIn("Vietnamese", parts[1]["text"])
        self.assertEqual(out, {"say": "Đây là một quả táo. Nó màu đỏ.", "show": "Đây là một quả táo. Nó màu đỏ.", "source": "api"})

    def test_reading_and_translating_ask_for_the_text_only(self) -> None:
        os.environ["VR_VISION_SOURCE"] = "api"
        vision.ask(JPEG, "read", "", "vi")
        self.assertIn("Read all the text", SEEN["body"]["messages"][0]["content"][1]["text"])
        vision.ask(JPEG, "translate", "", "en")
        text = SEEN["body"]["messages"][0]["content"][1]["text"]
        self.assertIn("into English", text)
        self.assertIn("only the translation", text)

    def test_what_is_read_aloud_is_short_and_what_is_shown_is_all(self) -> None:
        long = " ".join(f"Câu số {n} của biển báo." for n in range(40))
        cloud.see = lambda image, text, tokens=300: long
        try:
            os.environ["VR_VISION_SOURCE"] = "api"
            out = vision.ask(JPEG, "read", "", "vi")
        finally:
            importlib.reload(cloud)  # puts the real function back for the other tests
        self.assertLessEqual(len(out["say"]), vision.SPOKEN_CHARS)
        self.assertTrue(out["say"].endswith("."))
        self.assertTrue(out["show"].startswith("Câu số 0"))
        self.assertGreater(len(out["show"]), len(out["say"]))

    # local

    def test_the_local_model_answers_when_it_is_the_source(self) -> None:
        asked = {}

        class Fake3B:
            def create_chat_completion(self, **kwargs):
                asked.update(kwargs)
                return {"choices": [{"message": {"content": "Một cái cốc."}}]}

        vision._session = Fake3B()
        vision.local_files = lambda: (self.local_file(), self.local_file())
        out = vision.ask(JPEG, "ask", "đây là gì", "vi")
        self.assertEqual((out["say"], out["source"]), ("Một cái cốc.", "local"))
        self.assertEqual(asked["messages"][0]["content"][0]["type"], "image_url")

    def local_file(self):
        import tempfile
        from pathlib import Path

        handle = tempfile.NamedTemporaryFile(delete=False)
        handle.close()
        self.addCleanup(os.unlink, handle.name)
        return Path(handle.name)

    def test_without_the_local_files_it_says_what_to_do(self) -> None:
        with self.assertRaises(vision.VisionError) as caught:
            vision.ask(JPEG, "ask", "x", "vi")
        self.assertIn("VR_VISION_SOURCE=local", str(caught.exception))

    def test_a_failed_api_falls_back_to_the_local_model_or_says_so(self) -> None:
        os.environ["VR_VISION_SOURCE"] = "api"
        os.environ["VR_SILICONFLOW_URL"] = "http://127.0.0.1:9"
        with self.assertRaises(vision.VisionError):
            vision.ask(JPEG, "ask", "x", "vi")  # nothing to fall back to
        cloud.reset()

        class Fake3B:
            def create_chat_completion(self, **kwargs):
                return {"choices": [{"message": {"content": "Local trả lời."}}]}

        vision._session = Fake3B()
        vision.local_files = lambda: (self.local_file(), self.local_file())
        out = vision.ask(JPEG, "ask", "x", "vi")
        self.assertEqual((out["say"], out["source"]), ("Local trả lời.", "local"))

    # the endpoint

    def call(self, body: dict, client: str = "127.0.0.1") -> tuple[int, dict]:
        sent: list[dict] = []
        raw = json.dumps(body).encode()
        scope = {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "path": "/api/vision/ask",
            "raw_path": b"/api/vision/ask", "query_string": b"", "root_path": "", "scheme": "https", "server": ("h", 5173),
            "client": (client, 1), "headers": [(b"host", b"h:5173"), (b"content-type", b"application/json"), (b"content-length", str(len(raw)).encode())],
        }

        async def receive():
            return {"type": "http.request", "body": raw, "more_body": False}

        async def send(message):
            sent.append(message)

        asyncio.run(server_app.app(scope, receive, send))
        return sent[0]["status"], json.loads(sent[1]["body"])

    def test_the_endpoint_answers_and_refuses_what_it_should(self) -> None:
        keep = vision.ask
        vision.ask = lambda image, what, question, locale: {"say": "ok", "show": "ok", "source": "local"}
        try:
            good = {"image": base64.b64encode(JPEG).decode(), "what": "read", "locale": "vi"}
            self.assertEqual(self.call(good), (200, {"say": "ok", "show": "ok", "source": "local"}))
            self.assertEqual(self.call({**good, "what": "hack"})[0], 422)
            self.assertEqual(self.call({**good, "image": "not base64!"})[0], 400)
            self.assertEqual(self.call({**good, "image": base64.b64encode(b"x" * (vision.MAX_IMAGE + 1)).decode()})[0], 413)
            self.assertEqual(self.call(good, client="192.168.1.9")[0], 401)  # the picture of the room is not for the network
        finally:
            vision.ask = keep

    def test_a_failure_is_a_503_with_the_reason(self) -> None:
        keep = vision.ask

        def broken(*args):
            raise vision.VisionError("no model here")

        vision.ask = broken
        try:
            status, body = self.call({"image": base64.b64encode(JPEG).decode(), "what": "ask", "locale": "vi"})
        finally:
            vision.ask = keep
        self.assertEqual((status, body["detail"]), (503, "no model here"))

    # the wearer can see and switch it

    def test_the_setup_card_has_a_row_for_looking_at_pictures(self) -> None:
        os.environ["VR_SILICONFLOW_KEY"] = "sk-test"
        card = switch.status("vi")
        self.assertIn("Nhìn hình: máy", card)
        switch.command("dùng API để nhìn hình", "vi")
        self.assertIn("Nhìn hình: API · " + cloud.DEFAULT_MODELS["VR_VISION_MODEL"], switch.status("vi"))
        self.assertTrue(cloud.wants("vision"))


class SightWordsTest(unittest.TestCase):
    def look(self, line: str, locale: str = "vi") -> str | None:
        out = sight.sight_command(line, locale)
        return out["value"]["what"] if out else None

    def test_asking_what_something_is(self) -> None:
        for line in ("cái này là gì", "đây là con gì", "nhìn cái này giúp tôi", "what is this", "look at this"):
            self.assertEqual(self.look(line), "ask", line)

    def test_reading_writing(self) -> None:
        for line in ("đọc chữ trên biển", "đọc cái biển này", "đọc thực đơn", "trên biển ghi gì", "read this sign", "what does this say"):
            self.assertEqual(self.look(line), "read", line)

    def test_translating_writing(self) -> None:
        for line in ("dịch cái này", "dịch giúp tôi cái menu", "translate this sign"):
            self.assertEqual(self.look(line), "translate", line)

    def test_the_older_looks_are_unchanged(self) -> None:
        self.assertEqual(self.look("đọc mã QR"), "code")
        self.assertEqual(self.look("tôi đang thấy gì"), "scene")
        self.assertEqual(self.look("what do I see"), "scene")

    def test_ordinary_lines_are_not_looks(self) -> None:
        for line in ("mấy giờ rồi", "đọc sách cho tôi nghe", "dịch vụ này tốt không", "read me a story", "what is the capital of France"):
            self.assertIsNone(self.look(line), line)

    def test_the_question_travels_with_the_look_and_a_short_ack_is_said_at_once(self) -> None:
        out = sight.sight_command("cái này là gì", "vi")
        self.assertEqual(out["value"]["question"], "cái này là gì")
        self.assertEqual(out["reply"], "Để mình xem.")
        self.assertEqual(sight.sight_command("tôi đang thấy gì", "vi")["reply"], "")  # the scene is answered at once, offline


class PluginFilesTest(unittest.TestCase):
    def test_the_plugin_is_registered_and_its_permissions_are_granted_by_hand(self) -> None:
        folder = SRC / "modules" / "vision-ask"
        for name in ("manifest.ts", "plugin.ts", "VisionAskModule.ts", "text.json"):
            self.assertTrue((folder / name).is_file(), name)
        self.assertIn("visionAsk", (SRC / "modules" / "registry.ts").read_text(encoding="utf-8"))
        grants = (SRC / "core" / "modules" / "permissions.ts").read_text(encoding="utf-8")
        self.assertIn('"vision-ask": ["network", "snapshot"]', grants)
        manifest = (folder / "manifest.ts").read_text(encoding="utf-8")
        self.assertIn('"network", "snapshot"', manifest)

    def test_the_page_key_is_sent_with_the_picture(self) -> None:
        self.assertIn("withAccessKey(", (SRC / "modules" / "vision-ask" / "VisionAskModule.ts").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
