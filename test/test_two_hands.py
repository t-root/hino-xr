"""Two hands pinching is one gesture, recognised once in Core and used by everything."""

from __future__ import annotations

import re
import unittest

from helpers import SRC, walk


class TwoHandsTest(unittest.TestCase):
    def test_it_is_recognised_in_core_input_and_nowhere_else(self) -> None:
        for path in walk(SRC):
            text = path.read_text(encoding="utf-8")
            relative = path.relative_to(SRC).as_posix()
            if relative.startswith("core/input/") or relative in {"shared/contracts/input.ts", "core/events/events.ts"}:
                continue
            self.assertNotIn("TwoHandGesture", text, relative)

    def test_plugins_never_read_two_hands_themselves(self) -> None:
        for path in walk(SRC / "modules"):
            text = path.read_text(encoding="utf-8")
            self.assertNotRegex(text, r"\bHandFrame\b|\bHandPointer\b|\.pointers\b|hand\.tracked", path.name)

    def test_the_manager_gives_up_each_hands_press_and_sends_a_wheel(self) -> None:
        manager = (SRC / "core/input/InteractionManager.ts").read_text(encoding="utf-8")
        self.assertIn("new TwoHandGesture", manager)
        self.assertRegex(manager, r"machine\.abort\(")
        self.assertIn('emit("twohand"', manager)
        self.assertIn("surface?.wheel", manager)

    def test_the_surface_zooms_with_the_event_a_mouse_wheel_sends(self) -> None:
        surface = (SRC / "core/input/DomPointerSurface.ts").read_text(encoding="utf-8")
        self.assertRegex(surface, r'new WheelEvent\("wheel"')

    def test_both_eyes_see_it_through_the_same_bus_event(self) -> None:
        events = (SRC / "core/events/events.ts").read_text(encoding="utf-8")
        self.assertTrue(re.search(r"\btwohand:\s*TwoHandEvent", events))


if __name__ == "__main__":
    unittest.main()
