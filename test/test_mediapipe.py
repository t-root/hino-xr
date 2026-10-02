"""MediaPipe WASM and models are served from this origin, as classic workers."""

from __future__ import annotations

import json
import re
import unittest

from helpers import ROOT, SRC, rel, walk


class MediaPipeAssetsTest(unittest.TestCase):
    def test_runtime_urls_are_on_this_origin(self) -> None:
        config = (SRC / "core/config.ts").read_text(encoding="utf-8")
        self.assertIn("mediapipe/wasm", config)
        self.assertIn("models/hand_landmarker.task", config)
        self.assertNotIn("https://cdn", config)
        self.assertNotIn("storage.googleapis.com", config)

    def test_copied_wasm_matches_the_vendored_package_when_both_exist(self) -> None:
        marker = ROOT / "public/mediapipe/.version"
        manifest = ROOT / "vendor/@mediapipe/tasks-vision/package.json"
        if not marker.exists() or not manifest.exists():
            return
        version = json.loads(manifest.read_text(encoding="utf-8"))["version"]
        self.assertEqual(marker.read_text(encoding="utf-8").strip(), version)

    def test_worker_entry_paths_point_at_real_files(self) -> None:
        entries: list[str] = []
        for path in walk(SRC):
            entries.extend(re.findall(r'spawnInferenceWorker\(\s*"([^"]+)"', path.read_text(encoding="utf-8")))
        self.assertGreater(len(entries), 0)
        for entry in entries:
            self.assertTrue((SRC / entry).exists(), entry)

    def test_workers_are_classic_never_modules(self) -> None:
        offenders = [
            rel(path)
            for path in walk(SRC)
            if re.search(r'new Worker\([^)]*type:\s*"module"', path.read_text(encoding="utf-8"), re.S)
        ]
        self.assertEqual(offenders, [])
