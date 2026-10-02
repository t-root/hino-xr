"""UI review checklist from the plan: one colour, no icons, translucent, square."""

from __future__ import annotations

import re
import unittest

from helpers import SRC, rel, walk

COLOUR_OWNERS = {"ui/theme.ts", "ui/styles.css"}
COLOUR_LITERAL = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|0x[0-9a-fA-F]{6}\b")
GLYPHS = re.compile(
    r"[\U0001F300-\U0001FAFF\u2190-\u21FF\u2500-\u27BF\u2B00-\u2BFF\uFE0F]"
)


def without_comments(text: str) -> str:
    return re.sub(r"/\*[\s\S]*?\*/", "", text)
    # line comments stripped below


class DesignSystemTest(unittest.TestCase):
    def setUp(self) -> None:
        self.sources = [
            {"id": rel(path), "text": path.read_text(encoding="utf-8")}
            for path in walk(SRC, (".ts", ".tsx", ".css"))
        ]
        self.styles = next(file["text"] for file in self.sources if file["id"] == "ui/styles.css")

    def test_finds_source_files(self) -> None:
        self.assertGreater(len(self.sources), 20)

    def test_colour_literals_only_in_theme_files(self) -> None:
        offenders = [
            file["id"]
            for file in self.sources
            if file["id"] not in COLOUR_OWNERS and COLOUR_LITERAL.search(file["text"])
        ]
        self.assertEqual(offenders, [])

    def test_no_icons_emoji_or_glyphs(self) -> None:
        def stripped(text: str) -> str:
            return re.sub(r"(^|\s)//.*$", "", without_comments(text), flags=re.M)

        offenders = [file["id"] for file in self.sources if GLYPHS.search(stripped(file["text"]))]
        self.assertEqual(offenders, [])

    def test_dom_surfaces_stay_translucent(self) -> None:
        backgrounds = [match.strip() for match in re.findall(r"background:\s*([^;]+);", self.styles)]
        self.assertGreater(len(backgrounds), 0)
        allowed = re.compile(
            r"var\(--(surface|surface-strong|hairline|text|accent-surface)\)|color-mix|transparent|none"
        )
        for background in backgrounds:
            self.assertRegex(background, allowed)

    def test_corners_are_square(self) -> None:
        radii = [match.strip() for match in re.findall(r"border-radius:\s*([^;]+);", self.styles)]
        self.assertGreater(len(radii), 0)
        self.assertTrue(all(value == "0" for value in radii))
        curves = [
            file["id"]
            for file in self.sources
            if re.search(r"quadraticCurveTo|arcTo|\.roundRect\(", file["text"])
        ]
        self.assertEqual(curves, [])

    def test_boot_hud_sizes_to_the_camera_frame_not_the_window(self) -> None:
        self.assertIn("72cqi", self.styles)
        self.assertIn("72cqb", self.styles)
        self.assertNotIn("72vmin", self.styles)
        self.assertNotRegex(self.styles, r"\.boot-hud[^{]*\{[^}]*\b(vw|vh|vmin)\b")
        self.assertIn(".camera-frame", self.styles)
        self.assertIn("container-type: size", self.styles)
        # Container queries belong to the camera picture, not the black eye square.
        camera = self.styles.split(".camera-frame {", 1)[1].split("}", 1)[0]
        self.assertIn("container-type: size", camera)
        self.assertNotIn("background", camera)
        self.assertNotIn("border", camera)
        eye = self.styles.split(".eye {", 1)[1].split("}", 1)[0]
        self.assertNotIn("container-type", eye)
        runtime = next(
            file["text"] for file in self.sources if file["id"] == "core/bootstrap/createVrRuntime.ts"
        )
        attach = runtime.split("videoLayer.attach", 1)[1].split("frameHub.attach", 1)[0]
        self.assertIn("mesh.visible = true", attach)
        self.assertIn("mesh.visible = true", runtime.split("const revealWorld", 1)[1])
        styles = next(file["text"] for file in self.sources if file["id"] == "ui/styles.css")
        veil = styles.split(".start__veil {", 1)[1].split("}", 1)[0]
        self.assertIn("opacity: 0.5", veil)
        cursor = next(file["text"] for file in self.sources if file["id"] == "core/rendering/CursorLayer.ts")
        self.assertNotRegex(cursor, r"CircleGeometry|RingGeometry")
        self.assertRegex(cursor, r"bracketsGeometry|squareRing")
        view = next(file["text"] for file in self.sources if file["id"] == "ui/components/StereoView.ts")
        self.assertIn("camera-frame", view)
        self.assertIn("options.mount(frame)", view)
        self.assertNotIn("stage: turnBox", view)
        self.assertIn("mapper.framePx", view)
        self.assertNotRegex(self.styles, r"\.(menu__body|hud|boot-hud)[^{]*\{[^}]*\b(vw|vh|vmin)\b")
        self.assertIn("84cqi", self.styles)
        self.assertIn("48cqi", self.styles)

    def test_scrolling_goes_through_scroll_box(self) -> None:
        styles = re.sub(r"/\*[\s\S]*?\*/", "", self.styles)
        values = [match.group(2).strip() for match in re.finditer(r"(?<![\w-])overflow(-x|-y)?:\s*([^;]+);", styles)]
        self.assertGreater(len(values), 0)
        self.assertTrue(all(value in {"hidden", "clip"} for value in values))
        self.assertTrue(any(file["id"] == "ui/components/ScrollBox.ts" for file in self.sources))

    def test_motion_can_be_turned_off(self) -> None:
        self.assertRegex(self.styles, r"animation:|transition:")
        self.assertRegex(
            self.styles,
            r"@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation-duration:[^;]+!important",
        )

    def test_native_scrollbar_chrome_is_removed(self) -> None:
        self.assertRegex(self.styles, r"scrollbar-width:\s*none")
        self.assertRegex(self.styles, r"::-webkit-scrollbar\s*\{[^}]*display:\s*none")

    def test_native_controls_are_rebuilt(self) -> None:
        self.assertNotRegex(self.styles, r"accent-color")
        self.assertRegex(self.styles, r'input\[type="range"\]\s*\{[\s\S]*?appearance:\s*none')
        self.assertRegex(self.styles, r'input\[type="checkbox"\]\s*\{[\s\S]*?appearance:\s*none')

    def test_css_colours_come_from_the_two_tokens(self) -> None:
        declarations = re.findall(r"#[0-9a-fA-F]{3,8}\b", self.styles)
        self.assertEqual(set(declarations), {"#a9e7ff", "#ff4d4d", "#000"})
