"""The on-screen keyboard comes up by itself, types into any text box, and is built once in Core."""

from __future__ import annotations

import json
import unittest

from helpers import ASSISTANT, SRC, walk


class KeyboardTest(unittest.TestCase):
    def test_the_phone_layout_reaches_every_printable_character(self) -> None:
        layout = json.loads((SRC / "shared/keyboard.json").read_text(encoding="utf-8"))
        self.assertEqual(set(layout), {"numbers", "letters", "symbols", "more"})
        self.assertEqual("".join(layout["numbers"]), "1234567890")
        self.assertEqual(len(layout["letters"]), 3)
        self.assertEqual("".join("".join(row) for row in layout["letters"]), "qwertyuiopasdfghjklzxcvbnm")
        typed = "".join(layout["numbers"]) + "".join(
            "".join(row) for page in (layout["letters"], layout["symbols"], layout["more"]) for row in page
        )
        # The comma and the period sit by the space bar on every page, so they are not in the layout.
        typed += ",."
        every_sign = "".join(chr(c) for c in range(33, 127) if not chr(c).isalnum())
        for char in every_sign:
            self.assertIn(char, typed, char)
        self.assertEqual(len(typed), len(set(typed)), "a character is on two keys")

    def test_it_rises_by_itself_and_keeps_the_phones_own_keyboard_down(self) -> None:
        source = (SRC / "core/input/keyboardInput.ts").read_text(encoding="utf-8")
        self.assertIn('"focusin"', source)
        self.assertIn('inputMode = "none"', source)
        self.assertIn(".show(", source)

    def test_a_box_put_away_and_chosen_again_brings_the_keyboard_back(self) -> None:
        source = (SRC / "core/input/keyboardInput.ts").read_text(encoding="utf-8")
        # A box that kept the focus gets no focusin, so choosing it must open the keyboard by itself.
        self.assertIn('"click"', source)
        self.assertIn("openKeyboardFor", source)
        self.assertIn("blur()", source)
        panel = (SRC / "ui/panels/KeyboardPanel.ts").read_text(encoding="utf-8")
        self.assertIn("closeKeyboard()", panel)

    def test_a_hand_pressing_a_text_box_gives_it_the_focus(self) -> None:
        surface = (SRC / "core/input/DomPointerSurface.ts").read_text(encoding="utf-8")
        self.assertIn("isTextEntry(target)", surface)
        self.assertIn("target.focus()", surface)
        self.assertIn("textarea", surface.split("const ACTIONABLE")[1].split(";")[0])

    def test_keys_type_into_the_box_as_a_person_would(self) -> None:
        source = (SRC / "core/input/keyboardInput.ts").read_text(encoding="utf-8")
        self.assertIn("setRangeText", source)
        self.assertIn('new InputEvent("input"', source)

    def test_the_keyboard_is_a_core_panel_drawn_per_eye_from_one_store(self) -> None:
        app = (SRC / "app/App.ts").read_text(encoding="utf-8")
        self.assertIn("KeyboardPanel(frame", app)
        panel = (SRC / "ui/panels/KeyboardPanel.ts").read_text(encoding="utf-8")
        self.assertIn("useKeyboardStore", panel)
        self.assertIn('"VI"', panel)  # the key that switches the typing language
        self.assertIn('"EN"', panel)
        self.assertIn('state.setLayer(letters ? "symbols" : "letters")', panel)  # letters to signs and back

    def test_no_plugin_makes_its_own_keyboard(self) -> None:
        for path in walk(SRC / "modules"):
            text = path.read_text(encoding="utf-8")
            self.assertNotIn("useKeyboardStore", text, path.name)
            self.assertNotIn("Telex", text, path.name)

    def test_the_microphone_key_has_a_server_end(self) -> None:
        client = (SRC / "core/models/ModelClient.ts").read_text(encoding="utf-8")
        self.assertIn("/dictate?locale=", client)
        app = (ASSISTANT / "app.py").read_text(encoding="utf-8")
        self.assertIn('"/api/voice/dictate"', app)


if __name__ == "__main__":
    unittest.main()
