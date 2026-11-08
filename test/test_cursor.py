"""The hand cursor is the topmost thing on screen, always (rules.md A0)."""

from __future__ import annotations

import re
import unittest

from helpers import SRC

TOP = 2147483647


class CursorOnTopTest(unittest.TestCase):
    def setUp(self) -> None:
        self.styles = (SRC / "ui/styles.css").read_text(encoding="utf-8")

    def test_the_cursor_layer_has_the_highest_possible_z_index_and_takes_no_presses(self) -> None:
        layer = self.styles.split(".cursor-layer {", 1)[1].split("}", 1)[0]
        self.assertIn(f"z-index: {TOP}", layer)
        self.assertIn("pointer-events: none", layer)

    def test_nothing_else_reaches_it(self) -> None:
        # Everything in the interface, and in the plugins' own styles, stays below the cursor.
        files = [SRC / "ui/styles.css", *SRC.glob("modules/*/styles.ts"), *SRC.glob("modules/*/*.css")]
        for path in files:
            text = path.read_text(encoding="utf-8")
            for match in re.finditer(r"z-index:\s*(\d+)", text):
                if path.name == "styles.css" and path.parent.name == "ui" and int(match.group(1)) == TOP:
                    continue
                self.assertLess(int(match.group(1)), TOP, f"{path.name}: {match.group(0)}")

    def test_the_cursor_is_dom_beside_the_frame_in_every_eye_not_a_mesh_in_the_scene(self) -> None:
        view = (SRC / "ui/components/StereoView.ts").read_text(encoding="utf-8")
        self.assertIn("CursorOverlay()", view)
        # Appended after the camera frame, so it is above it whatever the frame holds.
        self.assertLess(view.index("turnBox.append(frame)"), view.index("turnBox.append(cursor.root)"))
        layer = (SRC / "core/rendering/CursorLayer.ts").read_text(encoding="utf-8")
        self.assertNotIn("three", layer)
        self.assertNotIn("Mesh", layer)

    def test_the_cursor_is_never_drawn_round(self) -> None:
        css = self.styles.split(".cursor-layer {", 1)[1]
        self.assertNotIn("border-radius", css)


if __name__ == "__main__":
    unittest.main()
