"""Changing an installed plugin by voice: the model's reply, the staging, and the way to the command."""

from __future__ import annotations

import importlib.util
import sys
import unittest

from helpers import ASSISTANT, SRC

_spec = importlib.util.spec_from_file_location("pluginsmith_for_revise", ASSISTANT / "models/pluginsmith.py")
smith = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(smith)


class ReplyTest(unittest.TestCase):
    def test_a_reply_with_files_is_split_by_name(self) -> None:
        reply = 'FILE: A.ts\n```ts\nconst a = 1;\n```\nFILE: text.json\n```json\n{"a": 1}\n```'
        files = smith._parse_files(reply, {"A.ts", "text.json"})
        self.assertEqual(set(files), {"A.ts", "text.json"})

    def test_a_file_the_plugin_does_not_have_is_sent_back(self) -> None:
        with self.assertRaises(ValueError):
            smith._parse_files("FILE: B.ts\n```ts\nx\n```", {"A.ts"})
        with self.assertRaises(ValueError):
            smith._parse_files("FILE: text.json\n```json\n{oops\n```", {"text.json"})
        with self.assertRaises(ValueError):
            smith._parse_files("no files here", {"A.ts"})

    def test_downloads_and_packages_cannot_be_rewritten(self) -> None:
        self.assertEqual(smith.LOCKED, {"models.json", "vendor.json"})


class ApplyTest(unittest.TestCase):
    def test_applying_a_change_backs_up_builds_and_rolls_back(self) -> None:
        source = (ASSISTANT / "models/pluginsmith.py").read_text(encoding="utf-8")
        apply = source[source.index("def _apply_edit"):]
        for needle in ("BACKUP", "compile_check(target)", "frontend.bundle", "put everything back"):
            self.assertIn(needle, apply)

    def test_a_change_waits_in_the_pending_folder_like_a_new_plugin(self) -> None:
        source = (ASSISTANT / "models/pluginsmith.py").read_text(encoding="utf-8")
        self.assertIn('EDIT_SUFFIX = "--edit"', source)
        self.assertIn('(folder / "edit.json").is_file()', source)


class VoiceTest(unittest.TestCase):
    def setUp(self) -> None:
        sys.path.insert(0, str(ASSISTANT))
        from models import commands

        self.commands = commands
        self.plugins = [
            {"id": "map3d", "vi": "Bản đồ 3D", "en": "3D map", "enabled": True},
            {"id": "face-recognition", "vi": "Nhận diện khuôn mặt", "en": "Face recognition", "enabled": False},
        ]

    def test_fix_this_plugin_names_the_plugin_and_the_change(self) -> None:
        got = self.commands.plugin_command("sửa plugin bản đồ thêm nút phóng to", self.plugins, "vi")
        self.assertEqual((got["action"], got["id"]), ("revise", "map3d"))
        self.assertIn("nút", got["description"])
        english = self.commands.plugin_command("fix the 3D map plugin so the button is bigger", self.plugins, "en")
        self.assertEqual((english["action"], english["id"]), ("revise", "map3d"))

    def test_switching_and_creating_still_work(self) -> None:
        self.assertEqual(self.commands.plugin_command("bật plugin bản đồ", self.plugins, "vi")["action"], "enable")
        self.assertEqual(self.commands.plugin_command("tạo plugin đếm số người", self.plugins, "vi")["action"], "create")

    def test_a_plugin_that_does_not_exist_is_said_so(self) -> None:
        got = self.commands.plugin_command("sửa plugin thời tiết hiển thị nhiệt độ", self.plugins, "vi")
        self.assertEqual(got["action"], "none")

    def test_the_server_and_the_page_carry_it(self) -> None:
        self.assertIn('"/api/plugins/{plugin_id}/revise"', (ASSISTANT / "app.py").read_text(encoding="utf-8"))
        self.assertIn('command.action === "revise"', (SRC / "core/models/ModelBridge.ts").read_text(encoding="utf-8"))
        self.assertIn('"revise"', (SRC / "core/models/ModelClient.ts").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
