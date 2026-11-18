"""SiliconFlow calls, against a fake server on this machine: no network, no key."""

from __future__ import annotations

import importlib
import json
import os
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from helpers import ASSISTANT

sys.path.insert(0, str(ASSISTANT))
cloud = importlib.import_module("models.cloud")
sys.path.remove(str(ASSISTANT))

WAV = b"RIFF" + b"\x00" * 40
SEEN: dict = {}


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:  # noqa: D401
        pass

    def do_POST(self) -> None:  # noqa: N802
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        SEEN.update(path=self.path, auth=self.headers.get("Authorization"), type=self.headers.get("Content-Type"), body=body)
        if self.path == "/chat/completions" and json.loads(body).get("stream"):
            lines = [
                {"choices": [{"delta": {"content": "Xin "}}]},
                {"choices": []},
                {"choices": [{"delta": {"content": "chào"}}]},
            ]
            payload = "".join(f"data: {json.dumps(line)}\n\n" for line in lines) + "data: [DONE]\n\n"
            self._send(payload.encode(), "text/event-stream")
        elif self.path == "/chat/completions":
            self._send(json.dumps({"choices": [{"message": {"content": "ok"}}]}).encode(), "application/json")
        elif self.path == "/audio/transcriptions":
            self._send(json.dumps({"text": "<|en|><|NEUTRAL|>hello there"}).encode(), "application/json")
        elif self.path == "/audio/speech":
            self._send(WAV, "audio/wav")
        else:
            self.send_error(404)

    def _send(self, data: bytes, kind: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


class CloudTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.server = HTTPServer(("127.0.0.1", 0), Fake)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()

    def setUp(self) -> None:
        self.saved = {k: os.environ.get(k) for k in os.environ if k.startswith("VR_") or k.startswith("SILICONFLOW")}
        for key in self.saved:
            os.environ.pop(key, None)
        os.environ["VR_SILICONFLOW_KEY"] = "sk-test"
        os.environ["VR_SILICONFLOW_URL"] = f"http://127.0.0.1:{self.server.server_port}"
        cloud.reset()
        SEEN.clear()

    def tearDown(self) -> None:
        for key in [k for k in os.environ if k.startswith("VR_") or k.startswith("SILICONFLOW")]:
            os.environ.pop(key, None)
        os.environ.update({k: v for k, v in self.saved.items() if v is not None})
        cloud.reset()

    def test_every_stage_is_local_until_switched(self) -> None:
        for stage in ("chat", "stt", "tts"):
            self.assertFalse(cloud.wants(stage, "en"))

    def test_a_stage_needs_both_its_switch_and_a_key(self) -> None:
        os.environ["VR_LLM_SOURCE"] = "siliconflow"
        self.assertTrue(cloud.wants("chat"))
        del os.environ["VR_SILICONFLOW_KEY"]
        self.assertFalse(cloud.wants("chat"))

    def test_speech_goes_out_only_for_the_listed_languages(self) -> None:
        os.environ["VR_STT_SOURCE"] = "api"
        self.assertTrue(cloud.wants("stt", "en"))
        self.assertFalse(cloud.wants("stt", "vi"))
        os.environ["VR_CLOUD_VOICE_LANGS"] = "en, vi"
        self.assertTrue(cloud.wants("stt", "vi"))

    def test_a_failed_stage_rests_for_a_while(self) -> None:
        os.environ["VR_TTS_SOURCE"] = "api"
        cloud.failed("tts")
        self.assertFalse(cloud.wants("tts", "en"))
        cloud.reset()
        self.assertTrue(cloud.wants("tts", "en"))

    def test_the_answer_streams_in_pieces(self) -> None:
        pieces = list(cloud.chat_stream({"model": "m", "messages": [{"role": "user", "content": "hi"}]}))
        self.assertEqual(pieces, ["Xin ", "chào"])
        self.assertEqual(SEEN["auth"], "Bearer sk-test")

    def test_a_long_talk_is_cut_to_what_the_endpoint_takes(self) -> None:
        talk = [{"role": "system", "content": "s"}] + [{"role": "user", "content": str(n)} for n in range(30)]
        cloud.chat({"model": "m", "messages": talk})
        sent = json.loads(SEEN["body"])["messages"]
        self.assertEqual(len(sent), cloud.MAX_MESSAGES)
        self.assertEqual((sent[0]["role"], sent[-1]["content"]), ("system", "29"))

    def test_plugin_text_comes_back_whole(self) -> None:
        self.assertEqual(cloud.complete_text("VR_CODE_MODEL", "sys", "user", 100), "ok")
        self.assertEqual(json.loads(SEEN["body"])["model"], cloud.DEFAULT_MODELS["VR_LLM_MODEL"])

    def test_one_model_serves_every_language_job_unless_overridden(self) -> None:
        self.assertEqual(cloud.model("VR_CODE_MODEL"), cloud.model("VR_LLM_MODEL"))
        os.environ["VR_LLM_MODEL"] = "vendor/small"
        self.assertEqual((cloud.model("VR_CODE_MODEL"), cloud.model("VR_AGENT_MODEL")), ("vendor/small", "vendor/small"))
        os.environ["VR_CODE_MODEL"] = "vendor/big"
        self.assertEqual((cloud.model("VR_CODE_MODEL"), cloud.model("VR_AGENT_MODEL")), ("vendor/big", "vendor/small"))

    def test_listening_sends_the_file_and_drops_the_markers(self) -> None:
        self.assertEqual(cloud.transcribe(b"RIFFdata"), "hello there")
        self.assertTrue(SEEN["type"].startswith("multipart/form-data; boundary="))
        self.assertIn(b"RIFFdata", SEEN["body"])
        self.assertIn(cloud.DEFAULT_MODELS["VR_STT_MODEL"].encode(), SEEN["body"])

    def test_speaking_asks_for_a_wav_with_the_model_named_voice(self) -> None:
        self.assertEqual(cloud.speak("hello", 1.2), WAV)
        sent = json.loads(SEEN["body"])
        self.assertEqual((sent["response_format"], sent["speed"]), ("wav", 1.2))
        self.assertEqual(sent["voice"], "FunAudioLLM/CosyVoice2-0.5B:alex")

    def test_an_unreachable_server_is_a_cloud_error(self) -> None:
        os.environ["VR_SILICONFLOW_URL"] = "http://127.0.0.1:9"
        with self.assertRaises(cloud.CloudError):
            cloud.chat({"model": "m", "messages": [{"role": "user", "content": "hi"}]}, timeout=2)


if __name__ == "__main__":
    unittest.main()
