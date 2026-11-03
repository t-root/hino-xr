"""A model may call the menu's settings, but only through a fence that decides what happens."""

from __future__ import annotations

import importlib
import sys
import unittest

from helpers import ASSISTANT

sys.path.insert(0, str(ASSISTANT))
agent = importlib.import_module("models.agent")
controls = importlib.import_module("models.controls")
sys.path.remove(str(ASSISTANT))

CONTROLS = controls.parse_controls(
    [
        {"id": "voice.speed", "kind": "number", "vi": ["tốc độ đọc"], "en": ["speaking speed"], "min": 0.6, "max": 1.6,
         "step": 0.05, "value": 1.0, "default": 1.0, "unit": ""},
        {"id": "diagnostics", "kind": "toggle", "vi": ["chẩn đoán"], "en": ["diagnostics"], "value": True},
        {"id": "menu", "kind": "toggle", "vi": ["menu"], "en": ["menu"], "value": False, "open": True},
        {"id": "page.lens", "kind": "page", "vi": ["thấu kính"], "en": ["lens"]},
    ]
)
PLUGINS = [{"id": "face-detection", "vi": "Phát hiện khuôn mặt", "en": "Face detection", "enabled": False}]


def calls(*items):
    return lambda body: {"content": [{"type": "tool_use", "name": "change_setting", "input": item} for item in items]}


def plan(heard, post, locale="vi"):
    return agent.plan(heard, CONTROLS, PLUGINS, locale, post)


class FenceTest(unittest.TestCase):
    def test_a_relative_request_becomes_a_checked_value(self) -> None:
        out = plan("nói chậm lại chút", calls({"id": "voice.speed", "action": "decrease"}))
        self.assertEqual((out[0]["id"], round(out[0]["value"], 2)), ("voice.speed", 0.9))
        self.assertIn("giảm", out[0]["reply"])

    def test_a_number_the_model_overshoots_is_kept_inside_the_range(self) -> None:
        out = plan("đặt tốc độ đọc rất nhanh", calls({"id": "voice.speed", "action": "set", "value": 99}))
        self.assertEqual(out[0]["value"], 1.6)

    def test_an_id_the_page_never_sent_is_dropped(self) -> None:
        self.assertEqual(plan("tăng cái gì đó", calls({"id": "system.shutdown", "action": "on"})), [])

    def test_an_action_that_does_not_suit_the_control_is_dropped(self) -> None:
        self.assertEqual(plan("tăng chẩn đoán", calls({"id": "diagnostics", "action": "increase"})), [])
        self.assertEqual(plan("bật tốc độ đọc", calls({"id": "voice.speed", "action": "on"})), [])
        self.assertEqual(plan("tăng tốc độ đọc", calls({"id": "voice.speed", "action": "delete"})), [])

    def test_several_changes_in_one_line_all_happen(self) -> None:
        out = plan("tắt chẩn đoán và mở menu", calls({"id": "diagnostics", "action": "off"}, {"id": "menu", "action": "open"}))
        self.assertEqual([(c["id"], c["value"]) for c in out], [("diagnostics", False), ("menu", True)])
        self.assertEqual(out[1]["reply"], "Đã mở menu.")

    def test_a_plugin_is_switched_as_an_enable(self) -> None:
        out = plan("chạy cái nhận diện khuôn mặt đi", calls({"id": "plugin:face-detection", "action": "on"}))
        self.assertEqual((out[0]["action"], out[0]["id"]), ("enable", "face-detection"))

    def test_a_menu_section_opens(self) -> None:
        out = plan("cho tôi xem thấu kính", calls({"id": "page.lens", "action": "open"}))
        self.assertEqual((out[0]["id"], out[0]["value"]), ("page.lens", True))

    def test_the_model_choosing_nothing_leaves_the_line_to_the_chat(self) -> None:
        self.assertEqual(plan("tăng tốc độ ánh sáng là bao nhiêu", lambda body: {"content": [{"type": "text", "text": "ok"}]}), [])

    def test_a_failed_call_is_not_a_crash(self) -> None:
        def broken(body):
            raise OSError("offline")

        self.assertEqual(plan("tăng tốc độ đọc", broken), [])

    def test_plain_questions_never_leave_the_machine(self) -> None:
        def forbidden(body):
            raise AssertionError("sent to the network")

        for line in ("Mấy giờ rồi", "Hôm nay trời đẹp không", "what is the capital of France"):
            self.assertEqual(plan(line, forbidden), [])

    def test_only_the_listed_ids_are_offered_to_the_model(self) -> None:
        seen = {}

        def spy(body):
            seen.update(body)
            return {"content": []}

        plan("tăng tốc độ đọc", spy)
        offered = seen["tools"][0]["input_schema"]["properties"]["id"]["enum"]
        self.assertEqual(offered, ["voice.speed", "diagnostics", "menu", "page.lens", "plugin:face-detection"])
        self.assertIn("voice.speed (number)", seen["system"])


if __name__ == "__main__":
    unittest.main()
