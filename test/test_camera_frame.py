"""The camera picture is the parent of everything drawn (rules.md)."""

from __future__ import annotations

import math
import unittest

from helpers import SRC


def pack_center_squares(
    width: int, height: int, gap: int
) -> tuple[tuple[int, int, int, int], tuple[int, int, int, int]]:
    """Must match `packCenterSquares` in StereoLayout.ts."""
    landscape = width >= height
    long = width if landscape else height
    short = height if landscape else width
    seam = min(max(gap, 0), max(long - 2, 0))
    side = max(min((long - seam) // 2, short), 1)
    used = side * 2 + seam
    if landscape:
        x0 = (width - used) // 2
        y0 = (height - side) // 2
        return (x0, y0, side, side), (x0 + side + seam, y0, side, side)
    x0 = (width - side) // 2
    y0 = (height - used) // 2
    return (x0, y0, side, side), (x0, y0 + side + seam, side, side)


def square_frame_size(
    frustum: tuple[float, float],
    frame_scale: float,
) -> tuple[float, float]:
    """Must match `squareFrameSize` in CoordinateMapper.ts."""
    side = min(frustum[0], frustum[1]) * frame_scale
    return side, side


def cover_content_rect(aspect: float) -> tuple[float, float, float, float]:
    """Must match `coverContentRect` in CoordinateMapper.ts."""
    if aspect >= 1:
        width = 1.0 / aspect
        return (1.0 - width) / 2.0, 0.0, width, 1.0
    height = aspect
    return 0.0, (1.0 - height) / 2.0, 1.0, height


def cover_repeat(aspect: float, mirrored: bool) -> tuple[float, float]:
    """Must match `coverRepeat` in CoordinateMapper.ts."""
    repeat_x, repeat_y = 1.0, 1.0
    if aspect > 1:
        repeat_x = 1.0 / aspect
    elif 0 < aspect < 1:
        repeat_y = aspect
    if mirrored:
        repeat_x = -repeat_x
    return repeat_x, repeat_y


def camera_frame_px(
    frame: tuple[float, float, float, float],
    eye: tuple[float, float],
    bleed: int = 2,
) -> tuple[int, int, int, int]:
    """Must match `cameraFramePx` in CoordinateMapper.ts."""
    x, y, width, height = frame
    return (
        math.floor(x * eye[0]) - bleed,
        math.floor(y * eye[1]) - bleed,
        math.ceil(width * eye[0]) + bleed * 2,
        math.ceil(height * eye[1]) + bleed * 2,
    )


def display_to_frame(
    point: tuple[float, float],
    content: tuple[float, float, float, float],
    plane: tuple[float, float],
) -> tuple[float, float]:
    """Must match `displayToFrame` in CoordinateMapper.ts."""
    u = (point[0] - content[0]) / content[2] if content[2] else 0.5
    v = (point[1] - content[1]) / content[3] if content[3] else 0.5
    local_x = (u - 0.5) * plane[0]
    local_y = (0.5 - v) * plane[1]
    return local_x / plane[0] + 0.5, 0.5 - local_y / plane[1]


def camera_frame_in_eye(
    frustum: tuple[float, float],
    plane: tuple[float, float],
) -> tuple[float, float, float, float]:
    """Must match `cameraFrameInEye` in CoordinateMapper.ts."""
    width = min(1.0, plane[0] / frustum[0])
    height = min(1.0, plane[1] / frustum[1])
    return (1.0 - width) / 2.0, (1.0 - height) / 2.0, width, height


class CameraFrameParentTest(unittest.TestCase):
    def test_contain_16x9_in_a_square_letterboxes_vertically(self) -> None:
        x, y, width, height = camera_frame_in_eye((1.0, 1.0), (1.0, 9 / 16))
        self.assertEqual(x, 0.0)
        self.assertEqual(width, 1.0)
        self.assertAlmostEqual(height, 0.5625)
        self.assertAlmostEqual(y, 0.21875)

    def test_overlay_box_bleeds_to_cover_the_picture(self) -> None:
        left, top, width, height = camera_frame_px((0.0, 0.1, 1.0, 0.8), (960.0, 1080.0), 2)
        self.assertEqual(left, -2)
        self.assertEqual(width, 964)
        self.assertGreater(height, 0.8 * 1080)

    def test_cover_fills_the_eye(self) -> None:
        x, y, width, height = camera_frame_in_eye((1.0, 1.0), (1.8, 1.06))
        self.assertEqual((x, y, width, height), (0.0, 0.0, 1.0, 1.0))

    def test_camera_frame_stays_square_when_zoomed(self) -> None:
        frustum = (0.889, 1.0)
        full = camera_frame_in_eye(frustum, square_frame_size(frustum, 1.0))
        half = camera_frame_in_eye(frustum, square_frame_size(frustum, 0.5))
        full_px = (full[2] * frustum[0], full[3] * frustum[1])
        half_px = (half[2] * frustum[0], half[3] * frustum[1])
        self.assertAlmostEqual(full_px[0], full_px[1])
        self.assertAlmostEqual(half_px[0], half_px[1])
        self.assertAlmostEqual(half_px[0], full_px[0] * 0.5)
        self.assertAlmostEqual(full[2], 1.0)

    def test_zooming_the_frame_does_not_change_the_image_crop(self) -> None:
        crop = cover_content_rect(16 / 9)
        self.assertAlmostEqual(crop[2], 9 / 16)
        self.assertAlmostEqual(crop[3], 1.0)
        self.assertAlmostEqual(crop[0] * 2 + crop[2], 1.0)
        repeat_x, repeat_y = cover_repeat(16 / 9, False)
        self.assertAlmostEqual(repeat_x, 9 / 16)
        self.assertEqual(repeat_y, 1.0)
        mirror_x, _ = cover_repeat(16 / 9, True)
        self.assertAlmostEqual(mirror_x, -9 / 16)

    def test_display_points_map_onto_the_camera_square(self) -> None:
        content = cover_content_rect(16 / 9)
        plane = square_frame_size((1.0, 1.0), 1.0)
        centre_x, centre_y = display_to_frame((0.5, 0.5), content, plane)
        self.assertAlmostEqual(centre_x, 0.5)
        self.assertAlmostEqual(centre_y, 0.5)
        left_x, _ = display_to_frame((content[0], 0.5), content, plane)
        self.assertAlmostEqual(left_x, 0.0)

    def test_video_mesh_is_the_square_frame(self) -> None:
        mapper = (SRC / "core/rendering/CoordinateMapper.ts").read_text(encoding="utf-8")
        video = (SRC / "core/rendering/VideoLayer.ts").read_text(encoding="utf-8")
        self.assertIn("return this.frameSquareSize()", mapper)
        self.assertIn("coverRepeat", video)
        self.assertIn("applyCoverUv", video)

    def test_core_owns_the_frame_and_defaults_to_cover(self) -> None:
        mapper = (SRC / "core/rendering/CoordinateMapper.ts").read_text(encoding="utf-8")
        self.assertIn("const cameraFrameInEye =", mapper)
        self.assertIn("const cameraFramePx =", mapper)
        self.assertIn("const squareFrameSize =", mapper)
        self.assertIn("frameInEye()", mapper)
        self.assertIn('fit: "cover"', mapper)
        self.assertNotIn("viewScale", mapper)
        renderer = (SRC / "core/rendering/StereoRenderer.ts").read_text(encoding="utf-8")
        self.assertNotIn("viewScale", renderer)

    def test_stereo_eyes_meet_in_the_centre(self) -> None:
        layout = (SRC / "core/rendering/StereoLayout.ts").read_text(encoding="utf-8")
        self.assertIn("packCenterSquares", layout)
        self.assertNotIn("packFillPair", layout)
        self.assertNotIn("packSquarePair", layout)
        left, right = pack_center_squares(1920, 1080, 0)
        self.assertEqual(left, (0, 60, 960, 960))
        self.assertEqual(right, (960, 60, 960, 960))
        left, right = pack_center_squares(1920, 800, 0)
        self.assertEqual(left, (160, 0, 800, 800))
        self.assertEqual(right, (960, 0, 800, 800))
        self.assertEqual(left[0], 1920 - right[0] - right[2])
        left, right = pack_center_squares(1080, 1920, 0)
        self.assertEqual(left, (60, 0, 960, 960))
        self.assertEqual(right, (60, 960, 960, 960))

    def test_stereo_view_mounts_widgets_on_the_camera_frame(self) -> None:
        view = (SRC / "ui/components/StereoView.ts").read_text(encoding="utf-8")
        app = (SRC / "app/App.ts").read_text(encoding="utf-8")
        loading = (SRC / "ui/panels/LoadingOverlay.ts").read_text(encoding="utf-8")
        pointer = (SRC / "core/input/DomPointerSurface.ts").read_text(encoding="utf-8")
        runtime = (SRC / "core/bootstrap/createVrRuntime.ts").read_text(encoding="utf-8")
        mapper = (SRC / "core/rendering/CoordinateMapper.ts").read_text(encoding="utf-8")
        self.assertIn('className: "camera-frame"', view)
        self.assertIn("mapper.framePx", view)
        self.assertIn("type StereoMount =", view)
        self.assertIn("options.mount(frame)", view)
        self.assertNotIn("stage: turnBox", view)
        self.assertNotIn("options.mount(turnBox)", view)
        self.assertIn("mapper: runtime.renderer.mapper", app)
        self.assertIn("LoadingOverlay(frame)", app)
        self.assertIn("DiagnosticsOverlay(frame)", app)
        self.assertIn("SettingsPanel(frame", app)
        self.assertNotIn("LoadingOverlay({", app)
        self.assertIn("EYE_BLEED", view)
        self.assertIn("+ EYE_BLEED", view)
        self.assertIn("50% black", loading.lower())
        self.assertIn("start__veil", loading)
        self.assertIn("frame.append(veil, shell)", loading)
        self.assertNotIn("roots.stage", loading)
        self.assertNotIn("boot-hud__corner", loading)
        self.assertIn('querySelector(".camera-frame")', pointer)
        self.assertNotIn('querySelector(".eye")', pointer)
        self.assertIn("imageToFrame", runtime)
        # Detection boxes are drawn by Core, on the video plane, from every batch.
        self.assertIn("new OverlayRenderer(renderer.renderScene.overlayRoot", runtime)
        self.assertIn("overlay.submit(batch", runtime)
        self.assertNotIn("PaletteScene", runtime)
        self.assertNotIn("keydown", app)
        self.assertNotIn("KeyboardEvent", app)
        self.assertNotIn("event.key", app)
        self.assertIn("imageToFrame", mapper)
        self.assertIn("displayToFrame", mapper)

    def test_loading_is_solid_black_with_no_camera_and_no_frame_marks(self) -> None:
        styles = (SRC / "ui/styles.css").read_text(encoding="utf-8")
        start = styles.split(".start--boot {", 1)[1].split("}", 1)[0]
        self.assertIn("overflow: hidden", start)
        self.assertIn("transparent", start)
        veil = styles.split(".start__veil {", 1)[1].split("}", 1)[0]
        self.assertIn("color-mix", veil)
        self.assertIn("#000", veil)
        self.assertIn("opacity: 0.5", veil)
        self.assertNotIn("boot-hud__corner", styles)
        camera = styles.split(".camera-frame {", 1)[1].split("}", 1)[0]
        self.assertNotIn("background", camera)
        self.assertNotIn("border", camera)
        runtime = (SRC / "core/bootstrap/createVrRuntime.ts").read_text(encoding="utf-8")
        attach = runtime.split("videoLayer.attach", 1)[1].split("frameHub.attach", 1)[0]
        self.assertIn("mesh.visible = true", attach)
