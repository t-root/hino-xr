"""The assistant looking at a picture of the screen, and the one AI a plugin may use: two stages, kept apart."""

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
ai = importlib.import_module("ai")
vision = importlib.import_module("models.vision")
sight = importlib.import_module("models.sight_speech")
server_app = importlib.import_module("app")
sys.path.remove(str(ASSISTANT))

JPEG = b"\xff\xd8\xff\xe0fakejpeg"
SEEN: dict = {}


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass

    def do_POST(self) -> None:  # noqa: N802
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        SEEN.update(path=self.path, body=body)
        data = json.dumps({"choices": [{"message": {"content": SEEN.get("answer", "Lỗi 404: không tìm thấy trang. Hãy kiểm tra địa chỉ.")}}]}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class ScreenTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = HTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}/v1"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()

    def setUp(self) -> None:
        self.saved = {k: v for k, v in os.environ.items() if k.startswith("VR_")}
        for key in self.saved:
            os.environ.pop(key, None)
        os.environ["VR_VISION_URL"] = self.url
        os.environ["VR_PLUGIN_CHAT_URL"] = self.url
        ai.config.reset()
        SEEN.clear()

    def tearDown(self) -> None:
        for key in [k for k in os.environ if k.startswith("VR_")]:
            os.environ.pop(key, None)
        os.environ.update(self.saved)
        ai.config.reset()

    def test_the_screen_and_the_question_go_to_the_vision_stage(self) -> None:
        answer = vision.ask_screen(JPEG, "lỗi gì đây", "vi")
        content = SEEN["body"]["messages"][0]["content"]
        self.assertTrue(content[0]["image_url"]["url"].startswith("data:image/jpeg;base64,"))
        self.assertIn("lỗi gì đây", content[1]["text"])
        self.assertIn("error", content[1]["text"])
        self.assertIn("Vietnamese", content[1]["text"])
        self.assertTrue(answer["say"].startswith("Lỗi 404"))

    def test_what_is_read_aloud_is_short_and_what_is_shown_is_all(self) -> None:
        SEEN["answer"] = "Câu một khá dài. " * 40
        answer = vision.ask_screen(JPEG, "", "vi")
        self.assertLessEqual(len(answer["say"]), vision.SPOKEN_CHARS)
        self.assertGreater(len(answer["show"]), len(answer["say"]))
        self.assertLessEqual(len(answer["show"]), vision.SHOWN_CHARS)

    def test_an_empty_answer_or_a_failed_call_is_a_VisionError(self) -> None:
        SEEN["answer"] = "   "
        with self.assertRaises(vision.VisionError):
            vision.ask_screen(JPEG, "x", "en")
        os.environ["VR_VISION_URL"] = "http://127.0.0.1:1/v1"
        with self.assertRaises(vision.VisionError):
            vision.ask_screen(JPEG, "x", "en")

    # the endpoints

    def call(self, path: str, body: dict, client: str = "127.0.0.1") -> tuple[int, dict]:
        sent: list[dict] = []
        raw = json.dumps(body).encode()
        scope = {
            "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "POST", "path": path,
            "raw_path": path.encode(), "query_string": b"", "root_path": "", "scheme": "https", "server": ("h", 5173),
            "client": (client, 1), "headers": [(b"host", b"h:5173"), (b"content-type", b"application/json"), (b"content-length", str(len(raw)).encode())],
        }

        async def receive():
            return {"type": "http.request", "body": raw, "more_body": False}

        async def send(message):
            sent.append(message)

        asyncio.run(server_app.app(scope, receive, send))
        return sent[0]["status"], json.loads(sent[1]["body"])

    def test_the_screen_endpoint_answers_and_refuses_what_it_should(self) -> None:
        good = {"image": base64.b64encode(JPEG).decode(), "question": "đọc lỗi", "locale": "vi"}
        status, body = self.call("/api/assistant/screen", good)
        self.assertEqual(status, 200)
        self.assertIn("say", body)
        self.assertEqual(self.call("/api/assistant/screen", {**good, "image": "not base64!"})[0], 400)
        too_big = base64.b64encode(b"x" * (vision.MAX_IMAGE + 1)).decode()
        self.assertEqual(self.call("/api/assistant/screen", {**good, "image": too_big})[0], 413)
        self.assertEqual(self.call("/api/assistant/screen", good, client="192.168.1.9")[0], 401)  # the screen is not for the network

    def test_a_failure_is_a_503_with_the_reason(self) -> None:
        os.environ["VR_VISION_URL"] = "http://127.0.0.1:1/v1"
        status, body = self.call("/api/assistant/screen", {"image": base64.b64encode(JPEG).decode(), "locale": "vi"})
        self.assertEqual(status, 503)
        self.assertIn("vision", body["detail"])

    def test_a_plugin_asks_the_plugin_stage_and_never_the_assistants(self) -> None:
        os.environ["VR_CHAT_URL"] = "http://127.0.0.1:1/v1"  # Hino's own answering is down: the plugin is not affected
        status, body = self.call("/api/plugin-ai/chat", {"messages": [{"role": "user", "content": "xin chào"}]})
        self.assertEqual(status, 200)
        self.assertIn("Lỗi 404", body["text"])
        self.assertEqual(self.call("/api/plugin-ai/chat", {"messages": []})[0], 422)

    def test_there_is_no_camera_endpoint_for_pictures_any_more(self) -> None:
        self.assertNotIn("/api/vision/ask", (ASSISTANT / "app.py").read_text(encoding="utf-8"))
        self.assertNotIn("plugin-ai/vision", (ASSISTANT / "app.py").read_text(encoding="utf-8"))
        self.assertFalse((SRC / "modules" / "vision-ask").exists())


class SightWordsTest(unittest.TestCase):
    """The camera looks that remain are the scene and the code; the rest is the assistant's, at the screen."""

    def look(self, line: str, locale: str = "vi") -> str | None:
        out = sight.sight_command(line, locale)
        return out["value"]["what"] if out else None

    def test_the_two_looks_that_remain(self) -> None:
        self.assertEqual(self.look("đọc mã QR"), "code")
        self.assertEqual(self.look("tôi đang thấy gì"), "scene")
        self.assertEqual(self.look("what do I see"), "scene")

    def test_questions_about_a_picture_are_no_longer_a_camera_look(self) -> None:
        for line in ("cái này là gì", "đọc chữ trên biển", "dịch cái này", "mấy giờ rồi", "what is this", "translate this sign"):
            self.assertIsNone(self.look(line), line)


if __name__ == "__main__":
    unittest.main()
