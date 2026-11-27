
from __future__ import annotations

import json
import unittest

from helpers import ASSISTANT, ROOT


class VendorLockTest(unittest.TestCase):
    def test_pins_exact_versions(self) -> None:
        specs = json.loads((ROOT / "vendor.json").read_text(encoding="utf-8"))
        required = {"three", "zod", "zustand", "@mediapipe/tasks-vision", "esbuild"}
        self.assertTrue(required <= set(specs))
        for name, version in specs.items():
            self.assertIsInstance(version, str, name)
            self.assertFalse(any(mark in version for mark in "^~>=<"), f"{name}={version}")

    def test_unpacked_packages_match_their_pins_when_present(self) -> None:
        specs = json.loads((ROOT / "vendor.json").read_text(encoding="utf-8"))
        for name, version in specs.items():
            manifest = ROOT / "vendor" / name / "package.json"
            if not manifest.exists():
                continue
            installed = json.loads(manifest.read_text(encoding="utf-8"))["version"]
            self.assertEqual(installed, version, name)

    def test_plugins_load_on_demand_from_a_minified_bundle(self) -> None:
        frontend = (ASSISTANT / "frontend.py").read_text(encoding="utf-8")
        for flag in ("--splitting", "--minify", "--chunk-names=chunks/", "--external:@/*", '"/host/{module_path:path}"'):
            self.assertIn(flag, frontend, flag)
        self.assertIn('"/chunks/{chunk_path:path}"', frontend)

    def test_validation_uses_the_small_zod_build(self) -> None:
        schemas = (ASSISTANT.parent / "src/shared/validation/schemas.ts").read_text(encoding="utf-8")
        self.assertIn('from "zod/mini"', schemas)
        self.assertNotIn('from "zod";', schemas)

    def test_python_reads_vendor_json_not_package_json(self) -> None:
        frontend = (ASSISTANT / "frontend.py").read_text(encoding="utf-8")
        self.assertIn("vendor.json", frontend)
        self.assertNotIn("package.json dependencies", frontend)
        self.assertNotIn("LEGACY_NPM", frontend)
        self.assertNotIn("node_modules", frontend)
