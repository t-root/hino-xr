"""Looking by voice: the scene-description and code-reader plugins, and the words that ask for them."""

from __future__ import annotations

import json
import re
import unittest

from helpers import ASSISTANT, SRC

SCENE = SRC / "modules" / "scene-description"
CODE = SRC / "modules" / "code-reader"


class SightWordsTest(unittest.TestCase):
    def setUp(self) -> None:
        import sys

        sys.path.insert(0, str(ASSISTANT))
        from models.sight_speech import sight_command

        self.ask = sight_command

    def what(self, heard: str, locale: str = "vi") -> str | None:
        command = self.ask(heard, locale)
        return command["value"]["what"] if command else None

    def test_asking_what_is_in_view(self) -> None:
        for heard in ("Tôi đang thấy gì?", "xung quanh có gì", "Mô tả cảnh trước mặt"):
            self.assertEqual(self.what(heard), "scene", heard)
        for heard in ("what do I see", "describe the scene", "what's in front of me"):
            self.assertEqual(self.what(heard, "en"), "scene", heard)

    def test_asking_to_read_a_code(self) -> None:
        for heard in ("đọc mã", "Quét mã QR giúp tôi", "đọc mã này đi"):
            self.assertEqual(self.what(heard), "code", heard)
        for heard in ("read the QR code", "scan the barcode"):
            self.assertEqual(self.what(heard, "en"), "code", heard)

    def test_ordinary_talk_is_left_to_the_model(self) -> None:
        for heard in ("mà anh nói gì", "tôi đọc sách mà", "tôi thấy không biết làm gì", "hôm nay trời đẹp quá"):
            self.assertIsNone(self.ask(heard, "vi"), heard)

    def test_the_page_is_told_what_to_say_when_the_plugin_is_off(self) -> None:
        for heard, locale in (("đọc mã", "vi"), ("what do I see", "en"), ("đọc mã", "en")):
            missing = self.ask(heard, locale)["value"]["missing"]
            self.assertTrue(missing.strip())
        vi = self.ask("đọc mã", "vi")["value"]["missing"]
        en = self.ask("đọc mã", "en")["value"]["missing"]
        self.assertNotEqual(vi, en)

    def test_the_server_and_the_page_know_the_command(self) -> None:
        engine = (ASSISTANT / "models" / "engine.py").read_text(encoding="utf-8")
        self.assertIn("sight_command(heard, locale)", engine)
        client = (SRC / "core/models/ModelClient.ts").read_text(encoding="utf-8")
        self.assertIn('"sight"', client)
        bridge = (SRC / "core/models/ModelBridge.ts").read_text(encoding="utf-8")
        self.assertIn('command.action === "sight"', bridge)


class PluginsTest(unittest.TestCase):
    def test_both_are_registered(self) -> None:
        registry = (SRC / "modules/registry.ts").read_text(encoding="utf-8")
        self.assertIn("scene-description/plugin", registry)
        self.assertIn("code-reader/plugin", registry)

    def test_what_they_download_is_declared_with_a_hash(self) -> None:
        for plugin, assets in ((SCENE, "assets.ts"), (CODE, "assets.ts")):
            declared = {item["file"]: item for item in json.loads((plugin / "models.json").read_text(encoding="utf-8"))["files"]}
            self.assertTrue(declared)
            for item in declared.values():
                self.assertRegex(item["sha256"], r"^[0-9a-f]{64}$")
                self.assertTrue(item["url"].startswith("https://"))
            source = (plugin / assets).read_text(encoding="utf-8")
            for name in re.findall(r'urlOf\("([^"]+)"\)', source):
                self.assertIn(name, declared)

    def test_the_reader_finds_its_core_in_its_own_folder(self) -> None:
        worker = (CODE / "code.worker.ts").read_text(encoding="utf-8")
        self.assertIn("locateFile", worker)
        self.assertIn("importScripts(", worker)
        self.assertNotIn("https://", worker)
        declared = {item["file"] for item in json.loads((CODE / "models.json").read_text(encoding="utf-8"))["files"]}
        self.assertEqual(declared, {"zxing_reader.wasm", "zxing-reader.iife.js"})

    def test_the_scene_plugin_draws_nothing_and_answers_only_its_own_look(self) -> None:
        module = (SCENE / "SceneDescriptionModule.ts").read_text(encoding="utf-8")
        self.assertIn("detections: []", module)
        self.assertIn('payload.what !== "scene"', module)
        code = (CODE / "CodeReaderModule.ts").read_text(encoding="utf-8")
        self.assertIn('payload.what !== "code"', code)

    def test_neither_plugin_reaches_into_another(self) -> None:
        for plugin in (SCENE, CODE):
            for path in plugin.glob("*.ts"):
                self.assertNotRegex(path.read_text(encoding="utf-8"), r"from \"\.\./|from \"@/modules/", path.name)

    def test_both_languages_everywhere(self) -> None:
        for plugin in (SCENE, CODE):
            for key, value in json.loads((plugin / "text.json").read_text(encoding="utf-8")).items():
                self.assertEqual(set(value), {"vi", "en"}, f"{plugin.name}: {key}")
                self.assertTrue(value["vi"].strip() and value["en"].strip(), f"{plugin.name}: {key}")

    def test_every_class_the_scene_plugin_can_name_has_a_name(self) -> None:
        own = json.loads((SCENE / "text.json").read_text(encoding="utf-8"))
        object_scan = json.loads((SRC / "modules/object-detection/text.json").read_text(encoding="utf-8"))
        wanted = {key for key in object_scan if key.startswith("class.")}
        self.assertLessEqual(wanted, set(own))
        for count in range(1, 11):
            self.assertIn(f"number.{count}", own)


if __name__ == "__main__":
    unittest.main()
