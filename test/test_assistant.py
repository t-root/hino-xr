"""The spoken name is written once, in assistant.json."""

from __future__ import annotations

import json
import unittest

from helpers import ASSISTANT, SRC


class AssistantIdentityTest(unittest.TestCase):
    def test_name_is_written_once(self) -> None:
        identity = json.loads((SRC / "shared/assistant.json").read_text(encoding="utf-8"))
        name = identity["name"].strip()
        self.assertGreater(len(name), 0)

        identity_module = (SRC / "core/models/identity.ts").read_text(encoding="utf-8")
        catalog = (ASSISTANT / "models/catalog.py").read_text(encoding="utf-8")
        prompts = (ASSISTANT / "models/prompts.py").read_text(encoding="utf-8")
        engine = (ASSISTANT / "models/engine.py").read_text(encoding="utf-8")
        self.assertIn("assistant.json", identity_module)
        self.assertIn("assistant.json", catalog)
        self.assertIn("assistant_name", prompts)
        self.assertNotIn(name, engine)
        self.assertNotIn(name, prompts)


class VoiceTuningTest(unittest.TestCase):
    KEYS = ("pitchHz", "speed", "expression", "rhythm", "pause")

    def setUp(self) -> None:
        self.spec = json.loads((SRC / "shared/voice.json").read_text(encoding="utf-8"))

    def test_every_default_sits_inside_its_range(self) -> None:
        for key in self.KEYS:
            rule = self.spec[key]
            self.assertLess(rule["min"], rule["max"], key)
            self.assertLessEqual(rule["min"], rule["default"], key)
            self.assertLessEqual(rule["default"], rule["max"], key)
            self.assertGreater(rule["step"], 0, key)

    def test_the_web_and_the_server_read_the_same_file(self) -> None:
        contract = (SRC / "shared/contracts/voice.ts").read_text(encoding="utf-8")
        tuning = (ASSISTANT / "models/tuning.py").read_text(encoding="utf-8")
        app = (ASSISTANT / "app.py").read_text(encoding="utf-8")
        self.assertIn("voice.json", contract)
        self.assertIn("voice.json", tuning)
        for key in self.KEYS:
            self.assertIn(key, contract)
            self.assertIn(f'_range("{key}")', app)

    def test_every_setting_has_a_slider_in_the_assistant_menu(self) -> None:
        panel = (SRC / "ui/panels/SettingsPanel.ts").read_text(encoding="utf-8")
        for key in self.KEYS:
            self.assertIn(f"VOICE_RANGE.{key}", panel)

    def test_the_client_sends_the_voice_on_every_spoken_request(self) -> None:
        client = (SRC / "core/models/ModelClient.ts").read_text(encoding="utf-8")
        bridge = (SRC / "core/models/ModelBridge.ts").read_text(encoding="utf-8")
        self.assertEqual(client.count("voiceQuery(voice)"), 4)  # complete, wake, talk, preview
        self.assertEqual(bridge.count("this.voice()"), 4)  # wake, ask, talk, preview


class GreetingTest(unittest.TestCase):
    def test_the_default_greeting_is_written_once_for_every_language(self) -> None:
        identity = json.loads((SRC / "shared/assistant.json").read_text(encoding="utf-8"))
        self.assertEqual(identity["greeting"]["vi"], "Chào sếp")
        self.assertGreater(len(identity["greeting"]["en"].strip()), 0)
        catalog = (ASSISTANT / "models/catalog.py").read_text(encoding="utf-8")
        settings = (SRC / "core/state/settings.ts").read_text(encoding="utf-8")
        self.assertIn("assistant_greeting", catalog)
        self.assertIn("DEFAULT_GREETING", settings)

    def test_the_greeting_is_spoken_as_written_not_asked_of_the_model(self) -> None:
        engine = (ASSISTANT / "models/engine.py").read_text(encoding="utf-8")
        wake = engine[engine.index("def wake(") : engine.index("def _tts(")]
        self.assertNotIn("self.reply(", wake)
        self.assertNotIn("create_chat_completion", wake)
