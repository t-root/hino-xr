"""Sentences live in JSON, in every language, without lazy English in Vietnamese."""

from __future__ import annotations

import json
import re
import unittest

from helpers import SRC, rel, walk

LOCALES = ("vi", "en")
CATEGORIES = (
    "stereo",
    "orientation",
    "lens",
    "gesture",
    "cursor",
    "colour",
    "plugin",
    "assistant",
    "pipeline",
    "camera",
    "diagnostics",
    "log",
    "language",
)
BUILT_AT_RUNTIME = (
    "category.",
    "plugin.state.",
    "permission.",
    "hand.",
    "language.name.",
    "assistant.",
)
VIETNAMESE = re.compile(
    r"[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ]"
)
LAZY_ENGLISH = re.compile(
    r"\b(plugin|pipeline|render|model|console|overlay|worker|beta|log|fps|frame|zoom|scroll|settings|toggle|pinch|swipe|click)\b",
    re.I,
)


def placeholders(text: str) -> list[str]:
    return sorted(re.findall(r"\{(\w+)\}", text))


class LanguagesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.catalogue = json.loads((SRC / "i18n/text.json").read_text(encoding="utf-8"))
        self.modules = [path for path in (SRC / "modules").iterdir() if path.is_dir()]

    def test_every_entry_has_the_same_languages_and_blanks(self) -> None:
        self.assertGreater(len(self.catalogue), 0)
        for key, value in self.catalogue.items():
            self.assertEqual(sorted(value), sorted(LOCALES), key)
            for locale in LOCALES:
                self.assertGreater(len(value[locale].strip()), 0, f"{locale} {key}")
            self.assertEqual(placeholders(value["en"]), placeholders(value["vi"]), key)

    def test_vietnamese_is_written_in_vietnamese(self) -> None:
        entries: list[tuple[str, str]] = [(key, value["vi"]) for key, value in self.catalogue.items()]
        for folder in self.modules:
            text = json.loads((folder / "text.json").read_text(encoding="utf-8"))
            entries.extend((f"{folder.name}/{key}", value["vi"]) for key, value in text.items())
        offenders = [f"{key}: {sentence}" for key, sentence in entries if LAZY_ENGLISH.search(sentence)]
        self.assertEqual(offenders, [])

    def test_every_menu_entry_has_a_label(self) -> None:
        for category in CATEGORIES:
            key = f"category.{category}"
            self.assertIn(key, self.catalogue)
            for locale in LOCALES:
                self.assertGreater(len(self.catalogue[key][locale]), 0, f"{locale} {category}")

    def test_sentences_stay_out_of_typescript(self) -> None:
        offenders = [rel(path) for path in walk(SRC) if VIETNAMESE.search(path.read_text(encoding="utf-8"))]
        self.assertEqual(offenders, [])

    def test_no_orphan_catalogue_keys(self) -> None:
        code = "\n".join(path.read_text(encoding="utf-8") for path in walk(SRC))
        unused = [
            key
            for key in self.catalogue
            if not any(key.startswith(prefix) for prefix in BUILT_AT_RUNTIME) and f'"{key}"' not in code
        ]
        self.assertEqual(unused, [])

    def test_each_plugin_speaks_for_itself(self) -> None:
        for folder in self.modules:
            self.assertIn("text.json", [path.name for path in folder.iterdir()], folder.name)
            text = json.loads((folder / "text.json").read_text(encoding="utf-8"))
            for key, value in text.items():
                self.assertEqual(sorted(value), sorted(LOCALES), f"{folder.name} {key}")
                for locale in LOCALES:
                    self.assertGreater(len(value[locale].strip()), 0, f"{folder.name} {key} {locale}")
