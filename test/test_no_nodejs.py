"""The project never uses Node.js, npm, or node_modules."""

from __future__ import annotations

import unittest

from helpers import ASSISTANT, ROOT, SRC, walk


class NoNodeJsTest(unittest.TestCase):
    def test_lockfiles_and_npm_manifests_are_gone(self) -> None:
        for name in ("package.json", "package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"):
            self.assertFalse((ROOT / name).exists(), name)

    def test_vitest_config_and_typescript_tests_are_gone(self) -> None:
        self.assertFalse((ROOT / "vitest.config.ts").exists())
        leftover = [path.name for path in (ROOT / "test").glob("*.test.ts")]
        self.assertEqual(leftover, [])

    def test_source_does_not_import_node_or_vitest(self) -> None:
        offenders: list[str] = []
        for path in walk(SRC):
            text = path.read_text(encoding="utf-8")
            if 'from "vitest"' in text or "from 'vitest'" in text or "from node:" in text:
                offenders.append(path.relative_to(ROOT).as_posix())
        self.assertEqual(offenders, [])

    def test_run_scripts_never_call_npm_or_npx(self) -> None:
        for path in (ROOT / "run.py", ROOT / "run.bat", ASSISTANT / "frontend.py"):
            text = path.read_text(encoding="utf-8")
            self.assertNotRegex(text, r"\bnpm\b|\bnpx\b", msg=path.name)
