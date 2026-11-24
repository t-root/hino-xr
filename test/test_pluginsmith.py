"""A plugin the assistant writes is checked before it exists, and not installed until approved."""

from __future__ import annotations

import importlib
import re
import sys
import unittest

from helpers import ASSISTANT, SRC

sys.path.insert(0, str(ASSISTANT))
frontend = importlib.import_module("frontend")
smith = importlib.import_module("models.pluginsmith")  # a package member: it imports the `ai` package
sys.path.remove(str(ASSISTANT))

GOOD = smith._EXAMPLE


class CheckTest(unittest.TestCase):
    def test_the_example_the_model_is_shown_passes_its_own_checks(self) -> None:
        smith.check_code(GOOD)

    def test_code_that_runs_text_or_climbs_out_is_refused(self) -> None:
        for bad in (
            "eval('1')",
            "const f = new Function('return 1')",
            "const c = ({}).constructor",
            'await import("https://x.test/a.js")',
            "const p = a.__proto__",
        ):
            with self.assertRaises(ValueError, msg=bad):
                smith.check_code(GOOD + "\n" + bad)

    def test_a_plugin_with_permissions_may_use_the_network_and_the_page(self) -> None:
        for fine in ('await fetch("https://x.test")', "document.title", "setTimeout(() => 1, 5)", "localStorage.getItem('a')"):
            smith.check_code(GOOD + "\n" + fine)

    def test_only_imports_from_the_app_or_the_folder_are_allowed(self) -> None:
        with self.assertRaises(ValueError):
            smith.check_code('import { x } from "three";\n' + GOOD)
        with self.assertRaises(ValueError):
            smith.check_code('import { x } from "https://x.test/a.js";\n' + GOOD)
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
    def test_a_plugin_is_found_from_its_folder_and_nothing_outside_it_is_edited(self) -> None:
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            modules = Path(tmp) / "modules"
            for name, has_plugin in (("b-plugin", True), ("a-plugin", True), ("not-a-plugin", False)):
                (modules / name).mkdir(parents=True)
                if has_plugin:
                    (modules / name / "plugin.ts").write_text("export default {};", encoding="utf-8")
            keep = frontend.SRC, frontend.PLUGIN_INDEX
            frontend.SRC, frontend.PLUGIN_INDEX = Path(tmp), modules / "plugins.generated.ts"
            try:
                before = frontend.plugin_index()
                self.assertTrue(frontend.write_plugin_index())
                self.assertFalse(frontend.write_plugin_index())  # unchanged: the file keeps its time, so nothing is rebuilt
                (modules / "ai-people").mkdir()
                (modules / "ai-people" / "plugin.ts").write_text("export default {};", encoding="utf-8")
                after = frontend.plugin_index()
                self.assertTrue(frontend.write_plugin_index())
            finally:
                frontend.SRC, frontend.PLUGIN_INDEX = keep
        self.assertNotIn("ai-people", before)
        self.assertIn('import plugin0 from "./a-plugin/plugin";', after)  # in path order
        self.assertNotIn("not-a-plugin", after)
        self.assertIn('"./ai-people/plugin"', after)
        self.assertNotIn("registry", after)

    def test_installing_a_draft_touches_no_file_outside_the_plugin_folder(self) -> None:
        source = (ASSISTANT / "models/pluginsmith.py").read_text(encoding="utf-8")
        install = source[source.index("def _approve"):source.index("# --- changing a plugin that exists")]
        self.assertNotIn("registry", install.lower())
        self.assertNotIn("write_text", install)
        self.assertNotIn("_register", source)
        registry = (SRC / "modules/registry.ts").read_text(encoding="utf-8")
        self.assertNotRegex(registry, r"from \"\./[a-z-]+/plugin\"")  # no plugin is named there

    def test_a_draft_gets_the_permissions_it_asked_for_and_only_those(self) -> None:
        import tempfile
        from pathlib import Path

        meta = {k: {"vi": "x", "en": "y"} for k in ("displayName", "description", "label")}
        meta["permissions"] = ["camera-frame", "network"]
        with tempfile.TemporaryDirectory() as tmp:
            smith._write(Path(tmp) / "ai-net", "ai-net", meta, GOOD)
            manifest = (Path(tmp) / "ai-net" / "manifest.ts").read_text(encoding="utf-8")
        self.assertIn('permissions: ["camera-frame", "network"]', manifest)
        bad = (
            'META: {"id":"x","displayName":{"vi":"a","en":"b"},"description":{"vi":"a","en":"b"},'
            '"label":{"vi":"a","en":"b"},"permissions":["root"]}\n```ts\nx\n```'
        )
        with self.assertRaises(ValueError):
            smith._parse(bad)

    def test_assistant_plugins_are_granted_every_permission_by_their_prefix(self) -> None:
        grants = (SRC / "core/modules/permissions.ts").read_text(encoding="utf-8")
        self.assertIn('ASSISTANT_PLUGIN_PREFIX = "ai-"', grants)
        self.assertIn("startsWith(ASSISTANT_PLUGIN_PREFIX)) return []", grants)

    def test_drafts_default_to_a_camera_frame(self) -> None:
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

    def test_the_lock_is_not_held_while_the_model_writes(self) -> None:
        """Approving another plugin must not wait minutes for a draft that is still being written."""
        free_during_the_ask: list[bool] = []

        def slow_model(system: str, user: str) -> str:
            got = smith._lock.acquire(blocking=False)
            free_during_the_ask.append(got)
            if got:
                smith._lock.release()
            raise smith.DraftError("stop here")

        original = smith._complete
        smith._complete = slow_model
        try:
            with self.assertRaises(smith.DraftError):
                smith.draft("count people", "en")
        finally:
            smith._complete = original
        self.assertEqual(free_during_the_ask, [True])

    def test_the_code_stage_writes_and_its_failure_is_a_draft_error(self) -> None:
        import os

        keep = {k: os.environ.pop(k, None) for k in ("VR_CODE_URL",)}
        os.environ["VR_CODE_URL"] = "http://127.0.0.1:1/v1"
        try:
            with self.assertRaises(smith.DraftError) as caught:
                smith._complete("system", "user")
            self.assertIn("code", str(caught.exception))
        finally:
            os.environ.pop("VR_CODE_URL", None)
            for k, v in keep.items():
                if v is not None:
                    os.environ[k] = v


class RulesTest(unittest.TestCase):
    """The plugin rules are a file, and it is what the model is shown every time it writes or changes a plugin."""

    def test_the_file_is_there_and_short_enough_for_the_model_window(self) -> None:
        text = smith.rules()
        self.assertGreater(len(text), 1500)
        self.assertLess(len(text), 12000)  # the code model has 16k tokens for the rules, the plugin and the answer

    def test_it_is_put_after_both_prompts(self) -> None:
        for system in (smith._SYSTEM, smith._REVISE_SYSTEM):
            shown = smith.with_rules(system)
            self.assertTrue(shown.startswith(system))
            self.assertIn(smith.rules(), shown)
        self.assertIn("with_rules(_SYSTEM)", (ASSISTANT / "models/pluginsmith.py").read_text(encoding="utf-8"))
        self.assertIn("with_rules(_REVISE_SYSTEM)", (ASSISTANT / "models/pluginsmith.py").read_text(encoding="utf-8"))

    def test_it_is_read_every_time_so_an_edit_applies_at_once(self) -> None:
        import tempfile
        from pathlib import Path

        keep = smith.RULES
        with tempfile.TemporaryDirectory() as tmp:
            smith.RULES = Path(tmp) / "PLUGIN_RULES.md"
            try:
                smith.RULES.write_text("first rule", encoding="utf-8")
                self.assertIn("first rule", smith.with_rules("system"))
                smith.RULES.write_text("second rule", encoding="utf-8")
                self.assertIn("second rule", smith.with_rules("system"))
            finally:
                smith.RULES = keep

    def test_without_the_file_nothing_is_written(self) -> None:
        import tempfile
        from pathlib import Path

        keep = smith.RULES
        smith.RULES = Path(tempfile.gettempdir()) / "no-such-folder" / "PLUGIN_RULES.md"
        try:
            with self.assertRaises(smith.DraftError):
                smith.draft("count people", "en")
        finally:
            smith.RULES = keep

    def test_everything_the_checks_refuse_is_said_in_the_rules_first(self) -> None:
        text = smith.rules()
        for banned in ("eval", "Function", "import()", "require", "Proxy", "Reflect", "prototype", "__proto__", ".constructor",
                       "import.meta", "<script", "ServiceWorker", "SharedWorker"):
            self.assertIn(banned, text, banned)

    def test_what_the_project_tests_enforce_is_in_the_rules(self) -> None:
        text = smith.rules()
        for needle in ("text.json", "vi", "en", "@/ui/theme", "SharedState", "CanvasMirror", "frameClock", "Math.random",
                       "[data-twin-hover]", "overflow", "getUserMedia", "dispose", "plugin-ai/chat", "permissions"):
            self.assertIn(needle, text, needle)

    def test_a_revision_is_given_less_than_the_window_can_hold(self) -> None:
        self.assertLessEqual(smith.MAX_SOURCE, 30000)


if __name__ == "__main__":
    unittest.main()
