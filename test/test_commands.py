"""Plugins can be switched by voice: the line is a command, not a question for the model."""

from __future__ import annotations

import importlib.util
import sys
import unittest

from helpers import ASSISTANT, SRC


def _load():
    package = "models"
    sys.path.insert(0, str(ASSISTANT))
    try:
        spec = importlib.util.spec_from_file_location("models.commands", ASSISTANT / "models/commands.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules.setdefault(package, importlib.import_module(package))
        sys.modules["models.commands"] = module
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(ASSISTANT))


commands = _load()

PLUGINS = [
    {"id": "map3d", "vi": "Bản đồ 3D", "en": "3D map", "enabled": False},
    {"id": "face-detection", "vi": "Phát hiện khuôn mặt", "en": "Face detection", "enabled": True},
    {"id": "object-detection", "vi": "Quét đồ vật", "en": "Object scan", "enabled": False},
]


class CommandTest(unittest.TestCase):
    def test_turning_a_plugin_on_by_voice(self) -> None:
        for heard in ("Bật plugin bản đồ", "thêm plugin bản đồ 3D", "Turn on the 3D map plugin"):
            found = commands.plugin_command(heard, PLUGINS, "vi")
            self.assertEqual((found["action"], found["id"]), ("enable", "map3d"), heard)

    def test_turning_a_plugin_off_by_voice(self) -> None:
        found = commands.plugin_command("Tắt plugin phát hiện khuôn mặt", PLUGINS, "vi")
        self.assertEqual((found["action"], found["id"]), ("disable", "face-detection"))
        found = commands.plugin_command("turn off the face detection plugin", PLUGINS, "en")
        self.assertEqual(found["action"], "disable")

    def test_whisper_splitting_the_word_plugin_still_counts(self) -> None:
        found = commands.plugin_command("Bật plug-in quét đồ vật", PLUGINS, "vi")
        self.assertEqual(found["id"], "object-detection")

    def test_a_plugin_named_with_a_synonym_or_half_its_words_is_still_found(self) -> None:
        for heard in ("mở plugin nhận diện khuôn mặt", "Mở plugin khuôn mặt", "bật plugin nhận diện khuôn mặt giúp mình"):
            found = commands.plugin_command(heard, PLUGINS, "vi")
            self.assertEqual((found["action"], found["id"]), ("enable", "face-detection"), heard)

    def test_one_shared_word_is_not_enough_to_pick_a_plugin(self) -> None:
        self.assertEqual(commands.plugin_command("bật plugin nấu đồ ăn", PLUGINS, "vi")["action"], "none")

    def test_it_says_when_nothing_changes(self) -> None:
        self.assertIn("đang bật rồi", commands.plugin_command("bật plugin phát hiện khuôn mặt", PLUGINS, "vi")["reply"])

    def test_an_unknown_plugin_is_named_back_with_what_exists(self) -> None:
        found = commands.plugin_command("bật plugin nấu ăn", PLUGINS, "vi")
        self.assertEqual(found["action"], "none")
        self.assertIn("Bản đồ 3D", found["reply"])

    def test_ordinary_questions_go_to_the_model(self) -> None:
        for heard in ("Mấy giờ rồi", "Bản đồ Hà Nội ở đâu", "Plugin là gì", "Bật đèn lên"):
            self.assertIsNone(commands.plugin_command(heard, PLUGINS, "vi"), heard)

    def test_asking_for_a_new_plugin_carries_what_it_should_do(self) -> None:
        found = commands.plugin_command("Tạo plugin đếm số người trong phòng", PLUGINS, "vi")
        self.assertEqual(found["action"], "create")
        self.assertIn("đếm số người", found["description"])
        self.assertEqual(commands.plugin_command("viết plugin", PLUGINS, "vi")["action"], "none")

    def test_plugin_questions_are_not_requests_to_write_one(self) -> None:
        self.assertIsNone(commands.plugin_command("Plugin này làm gì vậy", PLUGINS, "vi"))

    def test_the_wearer_picks_who_writes_the_code(self) -> None:
        self.assertEqual(commands.plugin_command("dùng API để viết plugin", PLUGINS, "vi")["value"], "api")
        self.assertEqual(commands.plugin_command("chuyển sang local để viết plugin", PLUGINS, "vi")["value"], "local")
        self.assertEqual(commands.plugin_command("dừng plugin bản đồ", PLUGINS, "vi")["action"], "disable")

    def test_a_draft_is_approved_or_dropped_by_name(self) -> None:
        drafts = [{"id": "ai-dem-nguoi", "vi": "Đếm người", "en": "People counter"}]
        approve = commands.plugin_command("Duyệt plugin đếm người", PLUGINS, "vi", drafts)
        self.assertEqual((approve["action"], approve["id"]), ("approve", "ai-dem-nguoi"))
        reject = commands.plugin_command("từ chối plugin", PLUGINS, "vi", drafts)
        self.assertEqual((reject["action"], reject["id"]), ("reject", "ai-dem-nguoi"))
        self.assertEqual(commands.plugin_command("duyệt plugin", PLUGINS, "vi")["action"], "none")

    def test_the_page_is_trusted_only_as_far_as_its_shape(self) -> None:
        self.assertEqual(commands.parse_plugins("x"), [])
        kept = commands.parse_plugins([{"id": "a", "vi": "A", "en": "A", "enabled": 1}, {"id": 3}, "x"])
        self.assertEqual(kept, [{"id": "a", "vi": "A", "en": "A", "enabled": True}])


if __name__ == "__main__":
    unittest.main()
