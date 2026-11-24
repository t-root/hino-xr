"""The assistant looking at the screen: the words that ask for it, and the page that takes the picture."""

from __future__ import annotations

import importlib
import sys
import unittest

from helpers import ASSISTANT, SRC

sys.path.insert(0, str(ASSISTANT))
screen = importlib.import_module("models.screen_speech")
sys.path.remove(str(ASSISTANT))


class ScreenWordsTest(unittest.TestCase):
    def asked(self, line: str, locale: str = "vi") -> bool:
        return screen.screen_command(line, locale) is not None

    def test_asking_about_the_screen_or_an_error_on_it(self) -> None:
        for line in (
            "đọc lỗi trên màn hình",
            "màn hình này bị gì vậy",
            "trên màn hình đang ghi gì",
            "xem giúp tôi màn hình",
            "lỗi này là gì",
            "giải thích cái lỗi này",
            "what is on the screen",
            "read the screen",
            "what does this error say",
            "explain this error",
        ):
            self.assertTrue(self.asked(line, "en" if line.isascii() else "vi"), line)

    def test_ordinary_lines_are_left_alone(self) -> None:
        for line in (
            "mấy giờ rồi", "bật chế độ màn hình đôi", "thời tiết hôm nay", "what is the capital of France", "read me a story",
            "đọc sách cho tôi nghe", "dịch vụ này tốt không",
        ):
            self.assertFalse(self.asked(line, "en" if line.isascii() else "vi"), line)

    def test_the_question_travels_with_the_command_and_a_short_ack_is_said_at_once(self) -> None:
        out = screen.screen_command("đọc lỗi trên màn hình", "vi")
        self.assertEqual(out["action"], "screen")
        self.assertEqual(out["value"]["question"], "đọc lỗi trên màn hình")
        self.assertEqual(out["reply"], "Để mình xem.")
        self.assertIn("chụp được", out["value"]["failed"])  # what the page says when it cannot take the picture
        self.assertEqual(screen.screen_command("what is this error", "en")["reply"], "Let me look.")

    def test_the_camera_looks_are_not_taken_for_the_screen(self) -> None:
        self.assertFalse(self.asked("tôi đang thấy gì"))
        self.assertFalse(self.asked("đọc mã QR"))


class PageTest(unittest.TestCase):
    def test_the_page_takes_the_picture_and_sends_it_with_the_access_key(self) -> None:
        capture = (SRC / "core/screen/ScreenCapture.ts").read_text(encoding="utf-8")
        self.assertIn("export const captureScreen", capture)
        self.assertIn(".stereo-dom .eye", capture)  # one eye, not the two copies side by side
        self.assertNotIn("getDisplayMedia", capture.replace("`getDisplayMedia`", ""))  # no permission prompt, works on a phone
        self.assertIn("drawCamera(", capture)  # the camera picture is under the interface
        runtime = (SRC / "core/bootstrap/createVrRuntime.ts").read_text(encoding="utf-8")
        self.assertIn("setCameraView(() =>", runtime)
        self.assertIn("setCameraView(null)", runtime)  # nothing keeps a stopped camera alive
        client = (SRC / "core/models/ModelClient.ts").read_text(encoding="utf-8")
        self.assertIn("assistant/screen", client)
        self.assertIn("withAccessKey(init)", client)  # `send` adds the key to every request
        self.assertIn('"screen"', client)
        bridge = (SRC / "core/models/ModelBridge.ts").read_text(encoding="utf-8")
        self.assertIn('command.action === "screen"', bridge)
        self.assertIn("captureScreen()", bridge)

    def test_the_server_says_the_command_to_the_page(self) -> None:
        engine = (ASSISTANT / "models/engine.py").read_text(encoding="utf-8")
        self.assertIn("screen_command(heard, locale)", engine)
        # after the camera looks and the menu, before the tools: "đọc lỗi" is not a setting and not a weather question
        self.assertLess(engine.index("sight_command(heard, locale)"), engine.index("screen_command(heard, locale)"))
        self.assertLess(engine.index("screen_command(heard, locale)"), engine.index("tools.command(heard, locale)"))


if __name__ == "__main__":
    unittest.main()
