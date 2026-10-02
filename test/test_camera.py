"""Always the widest rear camera, never telephoto, never a zoomed stream."""

from __future__ import annotations

import re
import unicodedata
import unittest
from typing import NamedTuple

from helpers import SRC


def score_world_camera(label: str) -> int:
    """Must match `src/core/camera/pickWorldCamera.ts`."""
    text = "".join(
        char for char in unicodedata.normalize("NFD", label.lower()) if unicodedata.category(char) != "Mn"
    )
    if re.search(r"front|user|selfie|facetime|truedepth", text):
        return -200
    if (
        (re.search(r"tele|periscope|telephoto", text) or re.search(r"\b([2-9]|[1-9]\d+)(?:\.\d+)?x\b", text))
        and "ultra" not in text
    ):
        return -80
    score = 0
    if re.search(r"back|rear|environment|world|\bsau\b", text):
        score += 40
    if re.search(r"ultra|\buw\b|wide|goc rong|sieu rong|0\.5", text):
        score += 100
    return score


class FakeDevice(NamedTuple):
    kind: str
    label: str
    deviceId: str


def pick_world_camera(devices: list[FakeDevice]) -> str | None:
    cameras = [device for device in devices if device.kind == "videoinput"]
    if not cameras:
        return None
    ranked = sorted(cameras, key=lambda device: (-score_world_camera(device.label), device.label))
    return ranked[0].deviceId


class WorldCameraScoreTest(unittest.TestCase):
    def test_rejects_front_and_telephoto(self) -> None:
        self.assertLess(score_world_camera("Front Camera"), 0)
        self.assertLess(score_world_camera("FaceTime HD Camera"), 0)
        self.assertLess(score_world_camera("Back Telephoto Camera"), 0)
        self.assertLess(score_world_camera("camera2 2, facing back 3x"), score_world_camera("camera2 0, facing back"))

    def test_prefers_ultra_wide_rear(self) -> None:
        ultra = score_world_camera("Back Ultra Wide Camera")
        wide = score_world_camera("Back Camera")
        selfie = score_world_camera("Front Camera")
        self.assertGreater(ultra, wide)
        self.assertGreater(wide, selfie)
        self.assertGreater(score_world_camera("camera sau siêu rộng 0.5"), 0)

    def test_picks_the_widest_labelled_rear_camera(self) -> None:
        devices = [
            FakeDevice("videoinput", "Front Camera", "front"),
            FakeDevice("videoinput", "Back Telephoto Camera", "tele"),
            FakeDevice("videoinput", "Back Camera", "wide"),
            FakeDevice("videoinput", "Back Ultra Wide Camera", "ultra"),
        ]
        self.assertEqual(pick_world_camera(devices), "ultra")


class CameraSourceTest(unittest.TestCase):
    def test_controller_picks_the_world_camera_and_widens_zoom(self) -> None:
        controller = (SRC / "core/camera/CameraController.ts").read_text(encoding="utf-8")
        picker = (SRC / "core/camera/pickWorldCamera.ts").read_text(encoding="utf-8")
        self.assertIn("pickWorldCamera", controller)
        self.assertIn("widenView", controller)
        self.assertIn("zoom.min", controller)
        self.assertIn("facingMode: { ideal: facing }", controller)
        open_fn = controller.split("const openStream", 1)[1].split("const waitForMetadata", 1)[0]
        self.assertNotIn("zoom", open_fn)
        self.assertIn("ultra", picker)
        self.assertIn("telephoto", picker)
        self.assertIn("goc rong", picker)

    def test_lens_settings_never_enter_the_camera_request(self) -> None:
        controller = (SRC / "core/camera/CameraController.ts").read_text(encoding="utf-8")
        self.assertNotIn("viewScale", controller)
        self.assertNotIn("fovYDeg", controller)
        self.assertNotIn("lens.", controller)
