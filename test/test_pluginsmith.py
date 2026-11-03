"""A plugin the assistant writes is checked before it exists, and not installed until approved."""

from __future__ import annotations

import importlib.util
import re
import unittest

from helpers import ASSISTANT, SRC

_spec = importlib.util.spec_from_file_location("pluginsmith_under_test", ASSISTANT / "models/pluginsmith.py")
smith = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(smith)

GOOD = smith._EXAMPLE


class CheckTest(unittest.TestCase):
    def test_the_example_the_model_is_shown_passes_its_own_checks(self) -> None:
        smith.check_code(GOOD)

    def test_code_that_reaches_outside_is_refused(self) -> None:
        for bad in (
            'fetch("https://x.test")',
            "document.body.innerHTML = ''",
            "setTimeout(() => 1, 5)",
            "eval('1')",
            "const w = new Worker('a.js')",
            "localStorage.setItem('a','b')",
            "const c = ({}).constructor",
            'await import("https://x.test/a.js")',
        ):
            with self.assertRaises(ValueError, msg=bad):
                smith.check_code(GOOD + "\n" + bad)

    def test_only_the_listed_imports_are_allowed(self) -> None:
        with self.assertRaises(ValueError):
            smith.check_code('import { x } from "three";\n' + GOOD)
        with self.assertRaises(ValueError):
            smith.check_code('import { x } from "@/core/state/RuntimeStore";\n' + GOOD)

    def test_a_file_must_export_the_factory_and_stay_small(self) -> None:
        with self.assertRaises(ValueError):
            smith.check_code(GOOD.replace("export const createModule", "const createModule"))
        with self.assertRaises(ValueError):
            smith.check_code(GOOD + "// " + "x" * smith.MAX_CODE)

    def test_a_forbidden_word_in_a_comment_is_only_a_comment(self) -> None:
        smith.check_code("// never use fetch here\n" + GOOD)


class ReplyTest(unittest.TestCase):
    META = (
        'META: {"id":"people","displayName":{"vi":"Đếm người","en":"People"},'
        '"description":{"vi":"a","en":"b"},"label":{"vi":"Người","en":"Person"}}'
    )

    def test_a_reply_is_split_into_meta_and_code(self) -> None:
        meta, code = smith._parse(f"{self.META}\n```ts\nconst a = 1;\n```")
        self.assertEqual(meta["displayName"]["vi"], "Đếm người")
        self.assertEqual(code.strip(), "const a = 1;")

    def test_a_reply_missing_a_language_is_sent_back(self) -> None:
        with self.assertRaises(ValueError):
            smith._parse(self.META.replace('"en":"People"', '"en":""') + "\n```ts\nx\n```")
        with self.assertRaises(ValueError):
            smith._parse("just chatting")

    def test_ids_are_prefixed_and_plain(self) -> None:
        self.assertTrue(smith._slug("Đếm Người!").startswith("dem-nguoi"))
        self.assertTrue(smith._unique_id("Đếm Người").startswith(smith.PREFIX))
        self.assertRegex(smith._unique_id("Đếm Người"), smith.ID_OK)


class InstallTest(unittest.TestCase):
    def test_a_plugin_is_listed_in_the_registry_by_one_import_and_one_entry(self) -> None:
        source = (SRC / "modules/registry.ts").read_text(encoding="utf-8")
        updated = smith._register("ai-people", source)
        self.assertIn('import aiPeople from "./ai-people/plugin";', updated)
        self.assertRegex(updated, r"personDetection, aiPeople\];")
        self.assertEqual(len(re.findall("aiPeople", updated)), 2)

    def test_a_draft_cannot_be_listed_twice(self) -> None:
        source = (SRC / "modules/registry.ts").read_text(encoding="utf-8")
        with self.assertRaises(ValueError):
            smith._register("ai-people", smith._register("ai-people", source))

    def test_drafts_cannot_ask_for_more_than_a_camera_frame(self) -> None:
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "ai-people"
            meta = {k: {"vi": "x", "en": "y"} for k in ("displayName", "description", "label")}
            smith._write(folder, "ai-people", meta, GOOD)
            manifest = (folder / "manifest.ts").read_text(encoding="utf-8")
            self.assertIn('permissions: ["camera-frame"]', manifest)
            plugin = (folder / "plugin.ts").read_text(encoding="utf-8")
            imports = re.findall(r'^import .*? from "([^"]+)";$', plugin, re.M)
            self.assertEqual(sorted(imports), ["./manifest", "@/core/modules/definePlugin"])

    def test_the_default_is_local_and_api_needs_a_key(self) -> None:
        import os

        keys = {k: os.environ.pop(k, None) for k in ("VR_ANTHROPIC_KEY", "ANTHROPIC_API_KEY")}
        try:
            smith.set_source("local")
            self.assertFalse(smith.set_source("api"))
            self.assertEqual(smith.source(), "local")
            os.environ["VR_ANTHROPIC_KEY"] = "test"
            self.assertTrue(smith.set_source("api"))
            smith.set_source("local")
        finally:
            os.environ.pop("VR_ANTHROPIC_KEY", None)
            for k, v in keys.items():
                if v is not None:
                    os.environ[k] = v


if __name__ == "__main__":
    unittest.main()
