
from __future__ import annotations

import re
import unittest

from helpers import SRC, walk

FORBIDDEN = re.compile(
    r"<(video|iframe|canvas|audio|img|object|embed)[\s/>]"
    r"|createElement\(\s*[\"'](video|iframe|canvas|audio|img|object|embed)"
    r"|\b(el|h)\(\s*[\"'](video|iframe|canvas|audio|img|object|embed)"
)

DUPLICATED = (SRC / "ui", SRC / "app", SRC / "modules")

SCROLLING = re.compile(r"overflow(-x|-y)?:\s*(auto|scroll)\b")
HOVER_RULE = re.compile(r"([^{}\n]*:hover[^{}]*)\{")


def code(text: str) -> str:
    text = re.sub(r"/\*[\s\S]*?\*/", "", text)
    return re.sub(r"(^|\s)//.*$", "", text, flags=re.M)


def sources(suffixes: tuple[str, ...] = (".ts",)) -> list[tuple[str, str]]:
    return [
        (path.relative_to(SRC).as_posix(), code(path.read_text(encoding="utf-8")))
        for directory in DUPLICATED
        for path in walk(directory, suffixes)
    ]


class StereoMarkupTest(unittest.TestCase):
    def test_ui_and_app_do_not_create_clock_owning_elements(self) -> None:
        offenders = [name for name, text in sources() if FORBIDDEN.search(text)]
        self.assertEqual(offenders, [])

    def test_plugins_keep_no_clock_or_dice_of_their_own(self) -> None:
        own = re.compile(r"\brequestAnimationFrame\(|\bsetInterval\(|\bMath\.random\(")
        offenders = [
            name for name, text in sources() if name.startswith("modules/") and own.search(text)
        ]
        self.assertEqual(offenders, [])

    def test_no_copy_keeps_its_own_scroll_offset(self) -> None:
        offenders = [
            name
            for name, text in sources((".ts",))
            if SCROLLING.search(text)
        ]
        self.assertEqual(offenders, [])

    def test_every_hover_style_is_mirrored_to_the_other_eye(self) -> None:
        texts = sources((".ts",)) + [("ui/styles.css", code((SRC / "ui/styles.css").read_text(encoding="utf-8")))]
        missing: list[str] = []
        for name, text in texts:
            for match in HOVER_RULE.finditer(text):
                selectors = [part.strip() for part in match.group(1).split(",")]
                for selector in selectors:
                    if ":hover" not in selector:
                        continue
                    twin = selector.replace(":hover", "[data-twin-hover]")
                    if twin not in selectors:
                        missing.append(f"{name}: {selector}")
        self.assertEqual(missing, [])
