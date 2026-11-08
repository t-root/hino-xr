"""Two rules for everything that can be pressed or typed into: no white and black ring, and not on an edge (A13, H7)."""

from __future__ import annotations

import re
import unittest

from helpers import SRC


def _styles() -> list:
    return [SRC / "ui/styles.css", *SRC.glob("modules/*/styles.ts"), *SRC.glob("modules/*/*.css")]


class FocusTest(unittest.TestCase):
    def setUp(self) -> None:
        self.css = (SRC / "ui/styles.css").read_text(encoding="utf-8")

    def test_the_browsers_white_and_black_focus_ring_is_off_for_everything(self) -> None:
        rule = re.search(r":focus,\s*:focus-visible\s*\{([^}]*)\}", self.css)
        self.assertIsNotNone(rule)
        self.assertIn("outline: none", rule.group(1))

    def test_focus_is_shown_in_the_interface_colour_as_an_inner_line(self) -> None:
        shown = re.search(r"input:focus-visible[^{]*\{([^}]*)\}", self.css)
        self.assertIsNotNone(shown)
        self.assertIn("inset 0 0 0 1px var(--ui-ink)", shown.group(1))

    def test_every_kind_of_text_box_has_the_one_look(self) -> None:
        block = self.css.split('input[type="text"],', 1)[1].split("{", 1)[0]
        for kind in ("search", "url", "email", "tel", "password"):
            self.assertIn(f'input[type="{kind}"]', block)
        self.assertIn("textarea", block)

    def test_nothing_draws_a_white_or_black_outline_or_the_default_ring(self) -> None:
        for path in _styles():
            text = path.read_text(encoding="utf-8")
            for match in re.finditer(r"outline(?:-color)?\s*:\s*([^;}]+)", text):
                value = match.group(1).lower()
                self.assertNotRegex(value, r"\bauto\b|white|black|#fff|#000|focus-ring", f"{path.name}: {match.group(0)}")


class PlacementTest(unittest.TestCase):
    PRESSABLE = re.compile(r"close|next|prev|locate|tools|bar|vkb|fid-card|zoom|m3-button", re.I)
    EDGE = re.compile(r"(?<![-\w])(top|right|bottom|left)\s*:\s*(-?[\d.]+)(rem|px|em|%|cqi|cqb|vw|vh)")

    def test_no_button_is_placed_a_few_pixels_from_an_edge(self) -> None:
        for path in _styles():
            text = path.read_text(encoding="utf-8")
            for block in re.finditer(r"([^{}]+)\{([^{}]*)\}", text):
                selector, body = block.group(1).strip(), block.group(2)
                if not self.PRESSABLE.search(selector) or "position: absolute" not in body:
                    continue
                for edge in self.EDGE.finditer(body):
                    name, amount, unit = edge.group(1), float(edge.group(2)), edge.group(3)
                    if unit in {"rem", "px", "em"} and amount != 0:
                        self.fail(f"{path.name}: {selector} puts {name} {amount}{unit} from the edge")
                    if unit in {"cqi", "cqb", "%", "vw", "vh"} and 0 < amount < 10 and name in {"left", "right"} and "50%" not in body:
                        self.fail(f"{path.name}: {selector} puts {name} only {amount}{unit} from the edge")

    def test_the_main_buttons_are_one_row_along_the_top_clear_of_the_map(self) -> None:
        css = (SRC / "modules/map3d/styles.ts").read_text(encoding="utf-8")
        bar = css.split(".map3d .m3-bar {", 1)[1].split("}", 1)[0]
        self.assertIn("left: 50%", bar)
        self.assertRegex(bar, r"top:\s*(1\d|[2-3]\d)(\.\d+)?cqb")
        # Close, Back and Next are not positioned on their own any more: they sit in the bar.
        for name in ("m3-close", "m3-next", "m3-prev"):
            self.assertNotRegex(css, rf"\.map3d \.{name}\s*\{{[^}}]*position: absolute")
        app = (SRC / "modules/map3d/Map3dApp.ts").read_text(encoding="utf-8")
        self.assertIn('"m3-bar"', app)

    def test_the_keyboard_and_the_card_are_lifted_off_the_bottom_edge(self) -> None:
        keyboard = (SRC / "ui/styles.css").read_text(encoding="utf-8").split(".vkb {", 1)[1].split("}", 1)[0]
        self.assertRegex(keyboard, r"bottom:\s*([5-9]|\d{2,})(\.\d+)?cqb")
        card = (SRC / "modules/face-recognition/styles.ts").read_text(encoding="utf-8").split(".fid-card {", 1)[1].split("}", 1)[0]
        self.assertRegex(card, r"bottom:\s*([5-9]|\d{2,})(\.\d+)?cqb")


if __name__ == "__main__":
    unittest.main()
