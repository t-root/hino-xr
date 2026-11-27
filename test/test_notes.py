
from __future__ import annotations

import importlib
import sys
import tempfile
import unittest
from pathlib import Path

from helpers import ASSISTANT

sys.path.insert(0, str(ASSISTANT))
notes = importlib.import_module("models.notes")
sys.path.remove(str(ASSISTANT))


class NotesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.keep = notes.FILE
        notes.FILE = Path(self.folder.name) / "data" / "notes.json"
        notes._pending.clear()

    def tearDown(self) -> None:
        notes.FILE = self.keep
        notes._pending.clear()

    def say(self, line: str, locale: str = "vi") -> dict | None:
        return notes.command(line, locale)

    def test_a_note_is_written_down_and_kept(self) -> None:
        out = self.say("ghi nhớ mua sữa cho bé")
        self.assertEqual(out["reply"], "Đã ghi nhớ: mua sữa cho bé.")
        self.assertEqual([item["text"] for item in notes.load()], ["mua sữa cho bé"])
        self.assertIn("2 việc", self.say("ghi chú gọi điện cho mẹ")["reply"])

    def test_a_note_in_english(self) -> None:
        self.assertEqual(self.say("remember to call mom tomorrow", "en")["reply"], "Noted: call mom tomorrow.")
        self.assertEqual(self.say("add a task buy bread", "en")["reply"], "Noted: buy bread. You have 2 items.")

    def test_a_note_without_content_asks_for_it(self) -> None:
        self.assertIn("ghi nhớ gì", self.say("ghi nhớ")["reply"])

    def test_the_list_is_read_a_few_at_a_time_and_shown_in_full(self) -> None:
        for n in range(6):
            self.say(f"ghi nhớ việc thứ {n}")
        out = self.say("đọc ghi chú")
        self.assertEqual(out["open"], "assistant")
        self.assertEqual(out["display"].count("\n"), 6)
        self.assertIn("Số 1:", out["reply"])
        self.assertIn("mình đã hiện trên màn hình", out["reply"])
        self.assertLessEqual(len(out["reply"]), 200)

    def test_an_empty_list_says_so(self) -> None:
        self.assertEqual(self.say("việc cần làm")["reply"], "Bạn chưa có ghi chú nào.")
        self.assertEqual(self.say("what's on my list", "en")["reply"], "You have no notes.")

    def test_a_note_is_marked_done_by_its_number(self) -> None:
        self.say("ghi nhớ mua sữa")
        self.say("ghi nhớ gọi mẹ")
        self.assertIn("Đã đánh dấu xong: gọi mẹ", self.say("xong việc số 2")["reply"])
        self.assertIn("đã xong rồi", self.say("xong việc số hai")["reply"])
        self.assertTrue(notes.load()[1]["done"])
        self.assertIn("[xong] gọi mẹ", self.say("xem ghi chú")["display"])

    def test_a_note_is_deleted_by_its_number(self) -> None:
        self.say("ghi nhớ một")
        self.say("ghi nhớ hai")
        self.assertIn("Đã xóa ghi chú 1", self.say("xóa ghi chú số 1")["reply"])
        self.assertEqual([item["text"] for item in notes.load()], ["hai"])
        self.assertIn("không có ghi chú số 5", self.say("xóa ghi chú số 5")["reply"])
        self.assertIn("Số mấy", self.say("xóa ghi chú")["reply"])

    def test_clearing_everything_waits_for_a_yes(self) -> None:
        self.say("ghi nhớ một")
        self.say("ghi nhớ hai")
        self.assertIn("xóa hết 2 ghi chú", self.say("xóa hết ghi chú")["reply"])
        self.assertEqual(len(notes.load()), 2)
        self.assertEqual(self.say("đúng rồi")["reply"], "Đã xóa hết ghi chú.")
        self.assertEqual(notes.load(), [])

    def test_a_no_or_another_line_keeps_the_notes(self) -> None:
        self.say("ghi nhớ một")
        self.say("xóa hết ghi chú")
        self.assertIn("giữ nguyên", self.say("không")["reply"])
        self.say("xóa hết ghi chú")
        self.assertIsNone(self.say("mấy giờ rồi"))
        self.assertIsNone(self.say("đúng rồi"))
        self.assertEqual(len(notes.load()), 1)

    def test_ordinary_talk_is_not_a_note(self) -> None:
        for line in ("mấy giờ rồi", "nhớ nhà quá", "tôi nhớ bạn", "remember when we went there", "ghi chú này là gì", "hôm nay trời đẹp"):
            self.assertIsNone(self.say(line), line)

    def test_a_cut_file_is_not_a_crash(self) -> None:
        notes.FILE.parent.mkdir(parents=True)
        notes.FILE.write_text("[{", encoding="utf-8")
        self.assertEqual(notes.load(), [])
        self.assertIn("Đã ghi nhớ", self.say("ghi nhớ lại từ đầu")["reply"])


if __name__ == "__main__":
    unittest.main()
