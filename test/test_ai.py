"""One configuration for every AI: a stage is an url, a key and a model, and one client serves them all."""

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
ai = importlib.import_module("ai")
sys.path.remove(str(ASSISTANT))

SEEN: dict = {}
WAV = b"RIFF....WAVEfake"


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:
        pass

    def _send(self, data: bytes, kind: str = "application/json") -> None:
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        SEEN.update(path=self.path, auth=self.headers.get("Authorization"))
        self._send(json.dumps({"data": [{"id": "b-model"}, {"id": "a-model"}]}).encode())

    def do_POST(self) -> None:  # noqa: N802
        raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        SEEN.update(path=self.path, auth=self.headers.get("Authorization"), raw=raw, type=self.headers.get("Content-Type"))
        if self.path == "/v1/audio/transcriptions":
            self._send(json.dumps({"text": " xin chào "}).encode())
        elif self.path == "/v1/audio/speech":
            self._send(WAV, "audio/wav")
        else:
            body = json.loads(raw)
            SEEN["body"] = body
            if body.get("stream"):
                lines = [{"choices": [{"delta": {"content": piece}}]} for piece in ("Xin ", "chào")]
                data = "".join(f"data: {json.dumps(line)}\n\n" for line in lines).encode() + b"data: [DONE]\n\n"
                self._send(data, "text/event-stream")
            else:
                self._send(json.dumps({"choices": [{"message": {"content": "đã rõ"}}]}).encode())


class AITest(unittest.TestCase):
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
        ai.config.reset()
        SEEN.clear()

    def tearDown(self) -> None:
        for key in [k for k in os.environ if k.startswith("VR_")]:
            os.environ.pop(key, None)
        os.environ.update(self.saved)
        ai.config.reset()

    # the one configuration

    def test_by_default_every_stage_is_a_server_of_this_machine(self) -> None:
        for name in ("chat", "agent", "vision", "code", "stt", "plugin_chat"):
            found = ai.stage(name)
            self.assertIsNotNone(found.server, name)
            self.assertTrue(found.url.startswith("http://127.0.0.1:"), name)
            self.assertFalse(found.external, name)
        self.assertTrue(ai.stage("tts").inprocess)

    def test_the_answering_model_reads_the_screen_and_works_the_menu_too(self) -> None:
        chat = ai.stage("chat")
        for name in ("agent", "vision"):
            self.assertEqual((ai.stage(name).url, ai.stage(name).model), (chat.url, chat.model))
        self.assertNotEqual(ai.stage("code").url, chat.url)

    def test_a_plugin_has_its_own_stage_not_the_assistants(self) -> None:
        self.assertIn("plugin_chat", ai.config.PLUGIN_STAGES)
        self.assertNotIn("plugin_chat", ai.config.ASSISTANT_STAGES)
        os.environ["VR_PLUGIN_CHAT_URL"] = self.url
        self.assertTrue(ai.stage("plugin_chat").external)
        self.assertFalse(ai.stage("chat").external)  # the plugin moved; Hino did not

    def test_an_api_of_somebody_else_needs_only_an_url_a_key_and_a_model(self) -> None:
        os.environ.update(VR_CHAT_URL="https://api.example.com/v1/", VR_CHAT_KEY="sk-x", VR_CHAT_MODEL="big")
        found = ai.stage("chat")
        self.assertEqual((found.url, found.key, found.model, found.server), ("https://api.example.com/v1", "sk-x", "big", None))
        self.assertTrue(found.external)
        for name in ("agent", "vision", "plugin_chat"):  # they follow chat, so one url moves them all
            self.assertEqual(ai.stage(name).url, "https://api.example.com/v1", name)
        self.assertFalse(ai.stage("code").external)

    def test_one_stage_can_be_split_off_from_the_one_it_follows(self) -> None:
        os.environ.update(VR_CHAT_URL="https://a.example/v1", VR_AGENT_URL="https://b.example/v1", VR_AGENT_KEY="k")
        self.assertEqual(ai.stage("agent").url, "https://b.example/v1")
        self.assertEqual(ai.stage("vision").url, "https://a.example/v1")

    def test_a_model_chosen_by_voice_wins_and_is_forgotten_on_reset(self) -> None:
        os.environ["VR_CHAT_MODEL"] = "from-env"
        ai.config.set_model("chat", "by-voice")
        self.assertEqual(ai.stage("chat").model, "by-voice")
        self.assertEqual(ai.stage("agent").model, "by-voice")
        ai.config.reset()
        self.assertEqual(ai.stage("chat").model, "from-env")
        with self.assertRaises(ai.config.ConfigError):
            ai.config.set_model("nonsense", "x")

    def test_the_file_names_a_server_for_every_local_stage(self) -> None:
        spec = ai.config.spec()
        for name, stage in spec["stages"].items():
            self.assertIn(name, ai.config.KIND)
            if stage.get("server"):
                self.assertIn(stage["server"], spec["servers"], name)
        for server in spec["servers"].values():
            self.assertTrue(server["model"].startswith("assistant/weights/"))

    # the one client

    def point(self, *names: str) -> None:
        for name in names:
            os.environ[f"VR_{name.upper()}_URL"] = self.url
            os.environ[f"VR_{name.upper()}_KEY"] = "sk-test"
        ai.config.reset()

    def test_a_chat_goes_to_the_url_with_the_key_and_the_model(self) -> None:
        self.point("chat")
        os.environ["VR_CHAT_MODEL"] = "m1"
        reply = ai.chat("chat", [{"role": "user", "content": "hi"}], 50, 0.2)
        self.assertEqual(reply["choices"][0]["message"]["content"], "đã rõ")
        self.assertEqual((SEEN["path"], SEEN["auth"]), ("/v1/chat/completions", "Bearer sk-test"))
        self.assertEqual((SEEN["body"]["model"], SEEN["body"]["max_tokens"], SEEN["body"]["stream"]), ("m1", 50, False))

    def test_an_answer_arrives_a_piece_at_a_time(self) -> None:
        self.point("chat")
        self.assertEqual(list(ai.chat_stream("chat", [{"role": "user", "content": "hi"}])), ["Xin ", "chào"])
        self.assertTrue(SEEN["body"]["stream"])

    def test_a_picture_goes_as_an_image_url(self) -> None:
        self.point("vision")
        self.assertEqual(ai.see("vision", b"\xff\xd8jpg", "what is this", 100), "đã rõ")
        content = SEEN["body"]["messages"][0]["content"]
        self.assertTrue(content[0]["image_url"]["url"].startswith("data:image/jpeg;base64,"))
        self.assertEqual(content[1], {"type": "text", "text": "what is this"})

    def test_text_is_a_system_line_and_a_question(self) -> None:
        self.point("code")
        self.assertEqual(ai.text("code", "be brief", "write", 100), "đã rõ")
        self.assertEqual([m["role"] for m in SEEN["body"]["messages"]], ["system", "user"])

    def test_listening_sends_the_language_the_words_to_expect_and_the_audio(self) -> None:
        self.point("stt")
        self.assertEqual(ai.transcribe(b"RIFFaudio", "vi", "Hino.", careful=False), "xin chào")
        self.assertEqual(SEEN["path"], "/v1/audio/transcriptions")
        self.assertTrue(SEEN["type"].startswith("multipart/form-data"))
        for part in (b'name="language"\r\n\r\nvi', b'name="prompt"\r\n\r\nHino.', b"RIFFaudio"):
            self.assertIn(part, SEEN["raw"])

    def test_beam_size_is_sent_only_to_the_server_of_this_machine(self) -> None:
        self.point("stt")  # an url of the wearer's own: whisper.cpp's own field would be rejected
        ai.transcribe(b"RIFFaudio", "vi", None, careful=True)
        self.assertNotIn(b"beam_size", SEEN["raw"])

    def test_speaking_with_an_url_returns_a_wav(self) -> None:
        self.point("tts")
        os.environ["VR_TTS_VOICE"] = "nova"
        ai.config.reset()
        self.assertEqual(ai.speak("xin chào", 1.2), WAV)
        self.assertEqual(json.loads(SEEN["raw"])["voice"], "nova")

    def test_the_models_an_endpoint_offers_are_listed_in_order(self) -> None:
        self.point("chat")
        self.assertEqual(ai.models("chat"), ["a-model", "b-model"])

    def test_a_failure_is_an_AIError_with_the_stage_in_it(self) -> None:
        os.environ["VR_CHAT_URL"] = "http://127.0.0.1:1/v1"
        with self.assertRaises(ai.AIError) as caught:
            ai.chat("chat", [{"role": "user", "content": "hi"}])
        self.assertIn("chat", str(caught.exception))
        with self.assertRaises(ai.AIError):
            ai.speak("x")  # the voice has no url: it runs inside this process

    # the servers of this machine

    def test_the_call_word_has_its_own_stage_that_follows_listening(self) -> None:
        self.assertIn("stt_wake", ai.config.ASSISTANT_STAGES)
        self.assertEqual(ai.stage("stt_wake").url, ai.stage("stt").url)
        os.environ["VR_STT_WAKE_URL"] = "http://127.0.0.1:1/v1"
        self.assertNotEqual(ai.stage("stt_wake").url, ai.stage("stt").url)  # a lighter model can be set for it alone

    def test_listening_asks_the_stage_that_fits_the_line(self) -> None:
        self.point("stt")
        os.environ["VR_STT_WAKE_URL"] = self.url.replace("/v1", "/v1")
        seen = []
        keep = ai.client._request

        def spy(stage, *args, **kwargs):
            seen.append(stage.name)
            return keep(stage, *args, **kwargs)

        ai.client._request = spy
        try:
            os.environ["VR_STT_WAKE_KEY"] = "sk-test"
            ai.config.reset()
            ai.transcribe(b"RIFFaudio", "vi", None, careful=True)
            ai.transcribe(b"RIFFaudio", "vi", None, careful=False)
        finally:
            ai.client._request = keep
        self.assertEqual(seen, ["stt", "stt_wake"])

    def test_a_server_can_be_told_its_threads_and_how_big_a_picture_may_be(self) -> None:
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            exe, model, mmproj = Path(tmp) / "llama-server.exe", Path(tmp) / "m.gguf", Path(tmp) / "p.gguf"
            for path in (exe, model, mmproj):
                path.write_bytes(b"x")
            keep = ai.servers.executable, dict(ai.config.servers()["llm"])
            ai.servers.executable = lambda kind: exe
            ai.config.servers()["llm"].update(model=str(model), mmproj=str(mmproj), threads=4, image_max_tokens=512, gpu_layers=0)
            try:
                command = ai.servers.command("llm")
            finally:
                ai.servers.executable = keep[0]
                ai.config.servers()["llm"].clear()
                ai.config.servers()["llm"].update(keep[1])
        self.assertEqual(command[command.index("-t") + 1], "4")
        self.assertEqual(command[command.index("--image-max-tokens") + 1], "512")
        self.assertEqual(command[command.index("-ngl") + 1], "0")
        self.assertEqual(command[command.index("--mmproj") + 1], str(mmproj))

    def test_a_server_that_is_not_downloaded_says_what_to_do(self) -> None:
        with self.assertRaises(ai.servers.ServerError) as caught:
            ai.servers.command("coder")
        self.assertIn("run.py", str(caught.exception))

    def test_a_stage_pointed_elsewhere_starts_no_server(self) -> None:
        for name in ("CHAT", "AGENT", "VISION", "PLUGIN_CHAT"):
            os.environ[f"VR_{name}_URL"] = "https://api.example.com/v1"
        self.assertFalse(ai.servers._wanted("llm"))
        self.assertTrue(ai.servers._wanted("whisper"))

    def test_the_coder_and_the_answering_model_share_one_gpu(self) -> None:
        servers = ai.config.servers()
        self.assertEqual(servers["llm"]["group"], servers["coder"]["group"])
        self.assertTrue(servers["coder"]["lazy"])
        self.assertNotIn("group", servers["whisper"])


if __name__ == "__main__":
    unittest.main()
