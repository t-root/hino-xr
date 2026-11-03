"""The menu can be worked by voice: the server turns a spoken line into a finished value."""

from __future__ import annotations

import importlib
import sys
import unittest

from helpers import ASSISTANT

sys.path.insert(0, str(ASSISTANT))
controls = importlib.import_module("models.controls")
sys.path.remove(str(ASSISTANT))


def number(id_, vi, en, low, high, step, value, default, unit=""):
    return {"id": id_, "kind": "number", "vi": [vi], "en": [en], "min": low, "max": high, "step": step,
            "value": value, "default": default, "unit": unit}


RAW = [
    number("voice.speed", "tốc độ đọc", "speaking speed", 0.6, 1.6, 0.05, 1.0, 1.0),
    number("assistant.listen", "thời gian ngủ", "sleep time", 2, 60, 1, 10, 10, "giây"),
    {"id": "diagnostics", "kind": "toggle", "vi": ["chẩn đoán"], "en": ["diagnostics"], "value": True},
    {"id": "menu", "kind": "toggle", "vi": ["menu"], "en": ["menu"], "value": False, "open": True},
    {"id": "page.assistant", "kind": "page", "vi": ["trợ lý"], "en": ["assistant"]},
    {"id": "page.lens", "kind": "page", "vi": ["thấu kính"], "en": ["lens"]},
    {"id": "locale", "kind": "choice", "vi": ["ngôn ngữ"], "en": ["language"],
     "options": [{"value": "vi", "vi": ["tiếng việt"], "en": ["vietnamese"]},
                 {"value": "en", "vi": ["tiếng anh"], "en": ["english"]}]},
]
CONTROLS = controls.parse_controls(RAW)


def run(heard, locale="vi"):
    return controls.control_command(heard, CONTROLS, locale)


class ControlTest(unittest.TestCase):
    def test_a_number_goes_up_and_down_by_a_tenth_of_its_range(self) -> None:
        up = run("Tăng tốc độ đọc")
        self.assertEqual((up["id"], round(up["value"], 2)), ("voice.speed", 1.1))
        down = run("giảm tốc độ đọc")
        self.assertEqual(round(down["value"], 2), 0.9)

    def test_a_number_can_be_set_exactly_and_is_kept_inside_its_range(self) -> None:
        self.assertEqual(run("đặt thời gian ngủ 20 giây")["value"], 20)
        self.assertEqual(run("đặt thời gian ngủ 500")["value"], 60)

    def test_a_number_can_be_set_to_an_end_a_percentage_or_its_default(self) -> None:
        self.assertEqual(run("tốc độ đọc tối đa")["value"], 1.6)
        self.assertEqual(round(run("đặt tốc độ đọc 50 phần trăm")["value"], 2), 1.1)
        self.assertEqual(run("tốc độ đọc mặc định")["value"], 1.0)

    def test_the_reply_says_the_value_that_was_set(self) -> None:
        self.assertIn("20 giây", run("đặt thời gian ngủ 20 giây")["reply"])
        self.assertIn("1 phẩy 1", run("tăng tốc độ đọc")["reply"])
        self.assertIn("sleep time", run("set sleep time to 30", "en")["reply"])

    def test_switches_go_on_and_off(self) -> None:
        self.assertEqual(run("tắt chẩn đoán")["value"], False)
        self.assertEqual(run("mở menu")["value"], True)
        self.assertIn("đang bật rồi", run("bật chẩn đoán")["reply"])

    def test_the_menu_is_answered_as_opened_not_turned_on(self) -> None:
        self.assertEqual(run("mở menu")["reply"], "Đã mở menu.")
        self.assertEqual(run("open the menu", "en")["reply"], "The menu is open.")
        self.assertIn("đang đóng rồi", run("đóng menu")["reply"])

    def test_a_menu_entry_opens_by_name_and_needs_the_word_muc(self) -> None:
        found = run("mở mục trợ lý")
        self.assertEqual((found["id"], found["value"]), ("page.assistant", True))
        self.assertEqual(run("mở mục thấu kính")["id"], "page.lens")

    def test_the_language_is_chosen_by_naming_it(self) -> None:
        self.assertEqual(run("chuyển sang tiếng Anh")["value"], "en")
        self.assertEqual(run("switch to vietnamese", "en")["value"], "vi")

    def test_ordinary_talk_is_left_to_the_model(self) -> None:
        for heard in ("Mấy giờ rồi", "Tốc độ ánh sáng là bao nhiêu", "Hôm nay trời đẹp", "kể chuyện cười đi"):
            self.assertIsNone(run(heard), heard)

    def test_a_verb_without_a_value_does_nothing(self) -> None:
        self.assertIsNone(run("đặt tốc độ đọc"))

    def test_the_page_is_trusted_only_as_far_as_its_shape(self) -> None:
        self.assertEqual(controls.parse_controls("x"), [])
        bad = [{"id": "a", "kind": "number", "vi": ["x"]}, {"id": "b", "kind": "weird", "vi": ["x"]}, 3]
        self.assertEqual(controls.parse_controls(bad), [])


if __name__ == "__main__":
    unittest.main()
