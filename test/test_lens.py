"""Lens optics must not darken or digitally zoom the camera picture."""

from __future__ import annotations

import unittest

from helpers import SRC


class LensNoZoomTest(unittest.TestCase):
    def test_scale_and_vignette_controls_are_gone(self) -> None:
        panel = (SRC / "ui/panels/SettingsPanel.ts").read_text(encoding="utf-8")
        settings = (SRC / "core/state/settings.ts").read_text(encoding="utf-8")
        self.assertNotIn("lens.viewScale", panel)
        self.assertNotIn("lens.mask", panel)
        self.assertNotIn("viewScale", panel)
        self.assertNotIn("maskRadius", panel)
        self.assertNotIn("maskRadius", settings)
        self.assertIn("lens.frameScale", panel)
        self.assertIn("frameScale", settings)
        self.assertIn("max: 1", panel.split("lens.frameScale", 1)[1][:400])

    def test_distortion_shader_does_not_zoom_or_darken(self) -> None:
        shader = (SRC / "core/rendering/LensDistortionPass.ts").read_text(encoding="utf-8")
        self.assertIn("factor / max(fit, 1.0)", shader)
        self.assertNotIn("uScale", shader)
        self.assertNotIn("uMaskRadius", shader)
        self.assertIn("clamp(source, 0.0, 1.0)", shader)
        self.assertNotIn("vec4(0.0, 0.0, 0.0, 1.0)", shader)
        self.assertIn("toneMapped: false", shader)
        self.assertIn("LinearSRGBColorSpace", shader)
        self.assertIn("#include <colorspace_fragment>", shader)
        self.assertIn("return true", shader)
        video = (SRC / "core/rendering/VideoLayer.ts").read_text(encoding="utf-8")
        self.assertIn("barrelUv", video)
        self.assertIn("uK1", video)
        self.assertIn("vec2( 0.5 )", video)
        self.assertNotIn("lensCenterOffset", video)

    def test_k1_k2_keep_the_camera_edge_from_zooming(self) -> None:
        # Mid-edge of a square eye must still sample the mid-edge after barrel,
        # otherwise k1/k2 shrink the picture like a zoom.
        k1, k2 = 0.3, 0.1
        uv = (1.0, 0.5)
        center = (0.5, 0.5)
        aspect = 1.0
        ox = (uv[0] - center[0]) * aspect
        oy = uv[1] - center[1]
        r2 = ox * ox + oy * oy
        factor = 1.0 + k1 * r2 + k2 * r2 * r2
        r2_fit = min(0.25 * aspect * aspect, 0.25)
        fit = max(1.0 + k1 * r2_fit + k2 * r2_fit * r2_fit, 1.0)
        source_x = center[0] + (uv[0] - center[0]) * factor / fit
        source_y = center[1] + (uv[1] - center[1]) * factor / fit
        self.assertAlmostEqual(source_x, 1.0)
        self.assertAlmostEqual(source_y, 0.5)
        uncorrected = center[0] + (uv[0] - center[0]) * factor
        self.assertGreater(uncorrected, 1.0)

    def test_cover_does_not_add_a_zoom_margin(self) -> None:
        mapper = (SRC / "core/rendering/CoordinateMapper.ts").read_text(encoding="utf-8")
        self.assertNotIn("coverMargin", mapper)
        self.assertIn("return this.frameSquareSize()", mapper)
        self.assertIn("export const coverRepeat", mapper)

    def test_frame_scale_resizes_the_square_not_the_shader(self) -> None:
        mapper = (SRC / "core/rendering/CoordinateMapper.ts").read_text(encoding="utf-8")
        renderer = (SRC / "core/rendering/StereoRenderer.ts").read_text(encoding="utf-8")
        shader = (SRC / "core/rendering/LensDistortionPass.ts").read_text(encoding="utf-8")
        video = (SRC / "core/rendering/VideoLayer.ts").read_text(encoding="utf-8")
        self.assertIn("squareFrameSize", mapper)
        self.assertIn("frameSquareSize()", mapper)
        self.assertIn("frameScale: this.lens.frameScale", renderer)
        self.assertIn("coverRepeat", video)
        self.assertIn("setBarrel", video)
        self.assertNotIn("uScale", shader)
        self.assertNotIn("viewScale", mapper)
        self.assertNotIn("viewScale", renderer)
