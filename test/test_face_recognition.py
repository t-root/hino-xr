"""Face recognition is one plugin, in one folder, that keeps people on the server and never a picture of a face."""

from __future__ import annotations

import json
import re
import unittest

from helpers import ASSISTANT, SRC

PLUGIN = SRC / "modules" / "face-recognition"


class PluginTest(unittest.TestCase):
    def test_it_replaced_the_old_detector_rather_than_joining_it(self) -> None:
        self.assertFalse((SRC / "modules" / "face-detection").exists())
        registry = (SRC / "modules/registry.ts").read_text(encoding="utf-8")
        self.assertIn("face-recognition/plugin", registry)
        self.assertNotIn("face-detection", registry)

    def test_every_file_the_code_names_is_declared_with_a_hash(self) -> None:
        declared = {item["file"]: item for item in json.loads((PLUGIN / "models.json").read_text(encoding="utf-8"))["files"]}
        assets = (PLUGIN / "assets.ts").read_text(encoding="utf-8")
        named = set(re.findall(r'urlOf\("([^"]+)"\)', assets))
        self.assertTrue(named, "assets.ts names no file")
        self.assertEqual(named, set(declared))
        for item in declared.values():
            self.assertRegex(item["sha256"], r"^[0-9a-f]{64}$")
            self.assertTrue(item["url"].startswith("https://"))

    def test_the_runtime_is_loaded_from_the_plugins_own_files(self) -> None:
        worker = (PLUGIN / "face.worker.ts").read_text(encoding="utf-8")
        module = (PLUGIN / "FaceRecognitionModule.ts").read_text(encoding="utf-8")
        self.assertIn("importScripts(", worker)
        self.assertNotIn("https://", worker)
        for name in ("ortScriptUrl", "ortBase", "embeddingUrl"):
            self.assertIn(f"{name}:", module)
            self.assertIn(f'"{name}"', worker)

    def test_the_server_serves_a_script_a_module_and_wasm_under_the_right_types(self) -> None:
        frontend = (ASSISTANT / "frontend.py").read_text(encoding="utf-8")
        self.assertIn('".mjs": "text/javascript"', frontend)
        self.assertIn('".wasm": "application/wasm"', frontend)

    def test_it_is_granted_what_it_asks_for_and_nothing_else(self) -> None:
        manifest = (PLUGIN / "manifest.ts").read_text(encoding="utf-8")
        asked = re.search(r"permissions:\s*\[([^\]]*)\]", manifest).group(1)
        self.assertEqual(set(re.findall(r'"([^"]+)"', asked)), {"camera-frame", "network", "screen"})
        grants = (SRC / "core/modules/permissions.ts").read_text(encoding="utf-8")
        self.assertIn('"face-recognition": ["network", "screen"]', grants)

    def test_no_picture_of_a_face_is_stored_or_sent(self) -> None:
        for path in PLUGIN.glob("*.ts"):
            text = path.read_text(encoding="utf-8")
            self.assertNotRegex(text, r"toDataURL|toBlob|convertToBlob|localStorage|indexedDB", path.name)
        self.assertNotIn("image", (PLUGIN / "peopleApi.ts").read_text(encoding="utf-8").lower())

    def test_all_its_words_are_in_both_languages(self) -> None:
        text = json.loads((PLUGIN / "text.json").read_text(encoding="utf-8"))
        for key, value in text.items():
            self.assertEqual(set(value), {"vi", "en"}, key)
        source = "".join(path.read_text(encoding="utf-8") for path in PLUGIN.glob("*.ts"))
        for key in re.findall(r'say\("(\w+)"', source):
            self.assertIn(key, text, key)

    def test_the_spoken_command_reaches_the_plugin_without_core_naming_it(self) -> None:
        bridge = (SRC / "core/models/ModelBridge.ts").read_text(encoding="utf-8")
        manager = (SRC / "core/modules/ModuleManager.ts").read_text(encoding="utf-8")
        self.assertIn('host.command("person"', bridge)
        self.assertIn("async command(", manager)
        self.assertNotIn("face-recognition", manager + bridge)
        self.assertIn("person_command", (ASSISTANT / "models/engine.py").read_text(encoding="utf-8"))

    def test_the_overlay_leaves_off_the_percentage_for_a_label_that_is_whole(self) -> None:
        overlay = (SRC / "core/rendering/OverlayRenderer.ts").read_text(encoding="utf-8")
        self.assertIn("plainLabel", overlay)


if __name__ == "__main__":
    unittest.main()
