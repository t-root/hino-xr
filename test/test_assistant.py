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
        self.assertIn("wake_prompt", prompts)
        self.assertIn("wake_prompt", engine)
        self.assertNotIn(name, engine)
        self.assertNotIn(name, prompts)
