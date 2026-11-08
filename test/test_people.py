"""The people the headset knows by face: kept in a file, checked on the way in, and said by voice."""

from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path

from helpers import ASSISTANT


def _load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, ASSISTANT / "models" / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


people_module = _load("people_under_test", "people.py")
speech = _load("person_speech_under_test", "person_speech.py")

FACE = [round(i / 128, 3) for i in range(128)]


class StoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.store = people_module.People(Path(self.dir.name) / "data" / "people.json")

    def test_a_person_is_kept_with_what_their_face_looks_like(self) -> None:
        made = self.store.create("  Nguyễn   Văn Nam ", 1990, "bạn đại học", FACE)
        self.assertEqual(made["name"], "Nguyễn Văn Nam")
        listed = self.store.list()
        self.assertEqual([item["id"] for item in listed], [made["id"]])
        self.assertEqual(listed[0]["year"], 1990)
        self.assertEqual(len(listed[0]["samples"]), 1)

    def test_it_survives_a_restart(self) -> None:
        made = self.store.create("Lan", None, "")
        again = people_module.People(self.store._path)
        self.assertEqual(again.list()[0]["id"], made["id"])

    def test_an_empty_name_or_an_impossible_year_is_refused(self) -> None:
        with self.assertRaises(people_module.PersonError):
            self.store.create("   ")
        with self.assertRaises(people_module.PersonError):
            self.store.create("Nam", 1500)
        with self.assertRaises(people_module.PersonError):
            self.store.create("Nam", 3000)
        with self.assertRaises(people_module.PersonError):
            self.store.create("Nam", "abc")
        self.assertEqual(self.store.list(), [])

    def test_a_face_that_is_not_a_list_of_numbers_is_refused(self) -> None:
        for bad in ("abc", [1, 2, 3], [float("nan")] * 128, ["x"] * 128):
            with self.assertRaises(people_module.PersonError):
                self.store.create("Nam", None, "", bad)

    def test_update_changes_only_what_is_named_and_can_clear_the_year(self) -> None:
        made = self.store.create("Nam", 1990, "cũ")
        self.store.update(made["id"], info="mới")
        kept = self.store.list()[0]
        self.assertEqual((kept["name"], kept["year"], kept["info"]), ("Nam", 1990, "mới"))
        self.store.update(made["id"], year=None)
        self.assertIsNone(self.store.list()[0]["year"])

    def test_more_samples_make_a_face_easier_to_find_but_only_the_newest_are_kept(self) -> None:
        made = self.store.create("Nam", None, "", FACE)
        for step in range(people_module.MAX_SAMPLES + 5):
            self.store.add_sample(made["id"], [value + step for value in FACE])
        samples = self.store.list()[0]["samples"]
        self.assertEqual(len(samples), people_module.MAX_SAMPLES)
        self.assertEqual(samples[-1][0], round(FACE[0] + people_module.MAX_SAMPLES + 4, 5))

    def test_a_sample_of_another_length_is_not_mixed_in(self) -> None:
        made = self.store.create("Nam", None, "", FACE)
        with self.assertRaises(people_module.PersonError):
            self.store.add_sample(made["id"], FACE[:64])

    def test_delete_removes_one_person(self) -> None:
        keep = self.store.create("Lan")
        gone = self.store.create("Nam")
        self.assertTrue(self.store.delete(gone["id"]))
        self.assertFalse(self.store.delete(gone["id"]))
        self.assertEqual([item["id"] for item in self.store.list()], [keep["id"]])

    def test_an_unknown_person_is_not_found(self) -> None:
        with self.assertRaises(KeyError):
            self.store.update("nobody", name="x")
        with self.assertRaises(KeyError):
            self.store.add_sample("nobody", FACE)

    def test_the_file_is_personal_data_and_stays_out_of_git(self) -> None:
        ignore = (ASSISTANT.parent / ".gitignore").read_text(encoding="utf-8")
        self.assertIn("assistant/data/", ignore)


class SpeechTest(unittest.TestCase):
    def say(self, text: str):
        return speech.person_command(text, "vi")

    def test_a_whole_description_in_one_line(self) -> None:
        found = self.say("Lưu người này, tên là Nam, sinh năm 1990, thông tin: bạn đại học.")
        self.assertEqual(found["action"], "person")
        self.assertEqual(found["value"], {"save": True, "name": "Nam", "year": 1990, "info": "bạn đại học"})
        self.assertEqual(found["reply"], "")

    def test_the_parts_may_come_in_any_order(self) -> None:
        found = self.say("Lưu người này, thông tin là hàng xóm, tên là Lan Anh, sinh năm 1985")
        self.assertEqual(found["value"], {"save": True, "name": "Lan Anh", "year": 1985, "info": "hàng xóm"})

    def test_a_part_alone_is_enough(self) -> None:
        self.assertEqual(self.say("Người này sinh năm 2001")["value"], {"save": False, "year": 2001})
        self.assertEqual(self.say("Thông tin người này là bạn học cũ")["value"]["info"], "bạn học cũ")

    def test_a_lower_case_name_is_capitalised(self) -> None:
        self.assertEqual(self.say("lưu người này tên là trần văn bình")["value"]["name"], "Trần Văn Bình")

    def test_years_said_in_words_are_understood(self) -> None:
        self.assertEqual(speech.vietnamese_year("một chín chín không"), 1990)
        self.assertEqual(speech.vietnamese_year("một nghìn chín trăm chín mươi"), 1990)
        self.assertEqual(speech.vietnamese_year("hai nghìn không trăm lẻ năm"), 2005)
        self.assertEqual(speech.vietnamese_year("năm 1975"), 1975)
        self.assertIsNone(speech.vietnamese_year("hôm nay"))

    def test_english_is_understood_too(self) -> None:
        found = speech.person_command("Save this person, name John Smith, born 1980, info neighbour from next door", "en")
        self.assertEqual(found["value"], {"save": True, "name": "John Smith", "year": 1980, "info": "neighbour from next door"})

    def test_ordinary_talk_that_uses_the_same_words_is_not_a_command(self) -> None:
        for line in (
            "Tên của bạn là gì",
            "Thông tin thời tiết hôm nay",
            "Bây giờ là mấy giờ",
            "What is your name",
            "Cho mình biết thông tin về Hà Nội",
        ):
            self.assertIsNone(self.say(line), line)


if __name__ == "__main__":
    unittest.main()
