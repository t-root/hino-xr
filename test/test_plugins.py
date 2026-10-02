"""A plugin is a folder; Core does not name plugins except for grants."""

from __future__ import annotations

import json
import re
import unittest

from helpers import ASSISTANT, SRC, rel, walk


class PluginDiscoveryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.folders = sorted(path.name for path in (SRC / "modules").iterdir() if path.is_dir())

    def test_every_plugin_folder_has_the_discovery_files(self) -> None:
        self.assertGreaterEqual(len(self.folders), 3)
        for folder in self.folders:
            names = {path.name for path in (SRC / "modules" / folder).iterdir()}
            self.assertIn("plugin.ts", names, folder)
            self.assertIn("manifest.ts", names, folder)

    def test_plugin_entry_only_imports_its_manifest_and_definePlugin(self) -> None:
        for folder in self.folders:
            source = (SRC / "modules" / folder / "plugin.ts").read_text(encoding="utf-8")
            imports = re.findall(r'^import .*? from "([^"]+)";$', source, re.M)
            self.assertEqual(sorted(imports), ["./manifest", "@/core/modules/definePlugin"], folder)
            self.assertRegex(source, r"await import\(")

    def test_core_does_not_name_plugins_except_in_grants(self) -> None:
        allowed = SRC / "core/modules/permissions.ts"
        offenders: list[str] = []
        for path in walk(SRC):
            try:
                parts = path.relative_to(SRC).parts
            except ValueError:
                continue
            if parts[0] == "modules" or path == allowed:
                continue
            text = path.read_text(encoding="utf-8")
            if any(folder in text for folder in self.folders):
                offenders.append(rel(path))
        self.assertEqual(offenders, [])

    def test_rules_file_covers_sync_and_plugins(self) -> None:
        # rules.md, at the root: the rules for rendering both eyes through Core
        # and for plugins that keep everything in their own folder.
        rules = (SRC.parent / "rules.md").read_text(encoding="utf-8")
        for needle in ("@/core/sync", "SharedState", "CanvasMirror", "frameClock", "models/", "vendor.json"):
            self.assertIn(needle, rules)

    def test_plugins_do_not_reach_into_each_other(self) -> None:
        offenders: list[str] = []
        for folder in self.folders:
            for path in walk(SRC / "modules" / folder):
                text = path.read_text(encoding="utf-8")
                for target in re.findall(r'(?:from|import)\s*\(?\s*"([^"]+)"', text):
                    if target.startswith("@/modules/") or target.startswith("../"):
                        offenders.append(f"{rel(path)} -> {target}")
        self.assertEqual(offenders, [])

    def test_core_vendor_lists_only_what_core_runs_on(self) -> None:
        # A library one plugin uses goes in that plugin's own vendor.json.
        core_dirs = [SRC / name for name in ("core", "ui", "shared", "app", "i18n")]
        core_text = "\n".join(path.read_text(encoding="utf-8") for d in core_dirs for path in walk(d))
        specs = json.loads((SRC.parent / "vendor.json").read_text(encoding="utf-8"))
        unused = [name for name in specs if name != "esbuild" and f'"{name}' not in core_text]
        self.assertEqual(unused, [])

    def test_plugins_import_packages_only_from_core_or_their_own_vendor(self) -> None:
        core_packages = set(json.loads((SRC.parent / "vendor.json").read_text(encoding="utf-8")))
        offenders: list[str] = []
        for folder in self.folders:
            for path in walk(SRC / "modules" / folder):
                text = path.read_text(encoding="utf-8")
                for target in re.findall(r'(?:from|import)\s*\(?\s*"([^"]+)"', text):
                    if target.startswith((".", "@/")):
                        continue
                    package = "/".join(target.split("/")[:2]) if target.startswith("@") else target.split("/")[0]
                    if package not in core_packages:
                        offenders.append(f"{rel(path)} -> {target}")
        self.assertEqual(offenders, [])

    def test_plugin_downloads_land_in_the_plugin_folder(self) -> None:
        frontend = (ASSISTANT / "frontend.py").read_text(encoding="utf-8")
        self.assertIn('"dest": folder / PLUGIN_MODELS_DIR', frontend)
        self.assertIn("ensure_package(name, version, folder / PLUGIN_VENDOR_DIR)", frontend)
        helper = (SRC / "core/modules/plugin-models.ts").read_text(encoding="utf-8")
        self.assertIn("plugins/${encodeURIComponent(pluginId)}/models/", helper)
        self.assertNotIn("publicModelUrl", helper)
        catalog = (ASSISTANT / "models/catalog.py").read_text(encoding="utf-8")
        self.assertIn('str(folder / slot["gguf"])', catalog)
        shared = SRC.parent / "public" / "models"
        for folder in self.folders:
            spec_path = SRC / "modules" / folder / "models.json"
            if not spec_path.exists():
                continue
            for item in json.loads(spec_path.read_text(encoding="utf-8")).get("files") or []:
                self.assertFalse((shared / item["file"]).exists(), f"{folder}: {item['file']} in public/models")

    def test_every_permission_is_validated_and_named(self) -> None:
        contract = (SRC / "shared/contracts/vision.ts").read_text(encoding="utf-8")
        union = re.search(r"export type ModulePermission = ([^;]+);", contract)
        self.assertIsNotNone(union)
        permissions = re.findall(r'"([a-z-]+)"', union.group(1))
        schemas = (SRC / "shared/validation/schemas.ts").read_text(encoding="utf-8")
        catalogue = json.loads((SRC / "i18n/text.json").read_text(encoding="utf-8"))
        for permission in permissions:
            self.assertIn(f'"{permission}"', schemas, permission)
            self.assertIn(f"permission.{permission}", catalogue, permission)

    def test_grants_only_name_installed_plugins(self) -> None:
        text = (SRC / "core/modules/permissions.ts").read_text(encoding="utf-8")
        self.assertIn("PERMISSION_GRANTS", text)

    def test_models_stay_inside_the_plugin_folder(self) -> None:
        frontend = (ASSISTANT / "frontend.py").read_text(encoding="utf-8")
        catalog = (ASSISTANT / "models/catalog.py").read_text(encoding="utf-8")
        config = (SRC / "core/config.ts").read_text(encoding="utf-8")
        self.assertIn("models.json", frontend)
        self.assertIn("models.json", catalog)
        self.assertNotRegex(frontend, r"efficientdet|blaze_face|face-detection|person-detection|demo-motion")
        self.assertNotRegex(catalog, r"face-detection|person-detection|demo-motion")
        self.assertNotRegex(config, r"efficientdet|blaze_face")

        for folder in self.folders:
            directory = SRC / "modules" / folder
            names = {path.name for path in directory.iterdir()}
            if "assets.ts" not in names:
                continue
            self.assertIn("models.json", names, folder)
            spec = json.loads((directory / "models.json").read_text(encoding="utf-8"))
            for item in spec.get("files") or []:
                self.assertTrue(item.get("file"), f"{folder} file")
                self.assertTrue(item.get("url"), f"{folder} url")
                self.assertRegex(item.get("sha256", ""), r"^[a-f0-9]{64}$", f"{folder} sha256")
            for slot in spec.get("slots") or []:
                self.assertTrue(slot.get("id"), f"{folder} slot id")
                self.assertRegex(slot.get("gguf", ""), r"\.gguf$", f"{folder} slot gguf")
