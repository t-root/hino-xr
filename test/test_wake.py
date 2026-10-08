"""The system starts on "system call", the assistant listens after its name."""

from __future__ import annotations

import importlib.util
import json
import re
import unittest

from helpers import ASSISTANT, SRC


def _load():
    spec = importlib.util.spec_from_file_location("wake_under_test", ASSISTANT / "models/wake.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


wake = _load()


class PhraseTest(unittest.TestCase):
    def test_the_system_call_is_english_and_stays_that_way(self) -> None:
        spec = json.loads((SRC / "shared/wake.json").read_text(encoding="utf-8"))
        self.assertEqual(spec["systemCall"], "system call")
        self.assertRegex(spec["systemCall"], r"^[a-z ]+$")

    def test_it_is_found_however_whisper_spells_it(self) -> None:
        for heard in ("System call.", "system  call", "systems call please", "sis tem call"):
            self.assertTrue(wake.find_phrase(heard, "system call")[0], heard)

    def test_other_speech_is_not_a_call(self) -> None:
        for heard in ("hello world", "the call of the system", "Hôm nay trời đẹp quá"):
            self.assertFalse(wake.find_phrase(heard, "system call")[0], heard)

    def test_the_assistants_name_is_found_in_vietnamese_and_english_spellings(self) -> None:
        for heard in ("Hi-no-ỡi mấy giờ rồi?", "Hino is", "hi nô", "Hải Nô ơi", "Heino nghe không", "Hino"):
            self.assertTrue(wake.find_phrase(heard, "hino")[0], heard)

    def test_ordinary_words_that_look_a_little_like_it_are_not_a_call(self) -> None:
        for heard in ("Hình ảnh này đẹp", "Tôi muốn xem hình", "Thời tiết hôm nay thế nào"):
            self.assertFalse(wake.find_phrase(heard, "hino")[0], heard)

    def test_the_words_after_the_call_are_the_question(self) -> None:
        found, rest = wake.find_phrase("Hino, what time is it", "hino")
        self.assertTrue(found)
        self.assertEqual(rest, ["what", "time", "is", "it"])
        self.assertEqual(wake.find_phrase("hi nô", "hino"), (True, []))

    def test_the_name_is_taken_off_the_front_of_a_question(self) -> None:
        self.assertEqual(wake.drop_leading_phrase("Hi-no-ỡi mấy giờ rồi?", "hino"), "mấy giờ rồi")
        self.assertEqual(wake.drop_leading_phrase("Mấy giờ rồi", "hino"), "Mấy giờ rồi")


class FlowTest(unittest.TestCase):
    def setUp(self) -> None:
        self.app = (SRC / "app/App.ts").read_text(encoding="utf-8")
        self.runtime = (SRC / "core/bootstrap/createVrRuntime.ts").read_text(encoding="utf-8")

    def test_the_fingerprint_only_opens_the_camera(self) -> None:
        start = self.app.index("const handleStart")
        body = self.app[start : self.app.index("const handleSettings")]
        self.assertIn("runtime.startCamera()", body)
        self.assertIn("listenForSystemCall", body)
        self.assertNotIn("startHands", body)
        self.assertNotIn("setStarting(true)", body)
        self.assertNotIn("models.load", body)
        self.assertNotIn("onSessionStart", body)

    def test_the_boot_runs_only_after_the_call(self) -> None:
        call = self.app.index("const handleSystemCall")
        body = self.app[call : self.app.index("const handleStart")]
        for step in ("setStarting(true)", "startHands()", "models.load()", "onSessionStart()", "revealWorld()"):
            self.assertIn(step, body)
        self.assertEqual(self.app.count("startHands()"), 1)
        self.assertEqual(self.app.count("setStarting(true)"), 1)

    def test_the_assistant_listens_for_its_name_only_once_the_system_is_up(self) -> None:
        call = self.app.index("const handleSystemCall")
        body = self.app[call : self.app.index("const handleStart")]
        self.assertGreater(body.index("listenForAssistant"), body.index("setStarting(false)"))

    def test_before_the_call_there_is_still_a_camera_and_two_eyes(self) -> None:
        start = self.app[self.app.index("const handleStart") : self.app.index("const handleSettings")]
        self.assertIn('setMode("stereo")', start)
        self.assertIn("runtime.startCamera()", start)
        # The two eyes are built whenever the session is: waiting to be called counts as one.
        self.assertIn("starting || armed || running", self.app)
        camera = self.runtime[self.runtime.index("const startCamera") : self.runtime.index("const startHands")]
        self.assertIn("videoLayer.mesh.visible = true", camera)
        self.assertIn("frameHub.start()", camera)
        # What waits for the call is drawn inside the eyes, never what makes them.
        eyes = self.app[self.app.index("const mountEyes") : self.app.index("const showStart")]
        self.assertNotIn("StereoView", eyes)

    def test_none_of_the_systems_interface_is_built_before_the_call(self) -> None:
        eyes = self.app[self.app.index("const mountEyes") : self.app.index("const showStart")]
        self.assertIn("armed ? null : mountInterface(frame)", eyes)
        interface = self.app[self.app.index("const mountInterface") : self.app.index("const mountEyes")]
        for part in ("LoadingOverlay(", "DiagnosticsOverlay(", "SettingsPanel(", "runtime.mountScreens("):
            self.assertIn(part, interface)
            self.assertNotIn(part, eyes)

    def test_hand_tracking_is_not_part_of_opening_the_camera(self) -> None:
        camera = self.runtime[self.runtime.index("const startCamera") : self.runtime.index("const startHands")]
        self.assertNotIn("handTracking", camera)

    def test_the_server_has_a_listen_endpoint(self) -> None:
        app = (ASSISTANT / "app.py").read_text(encoding="utf-8")
        self.assertIn('"/api/voice/listen"', app)
        self.assertRegex(app, re.compile(r"stripWake"))
