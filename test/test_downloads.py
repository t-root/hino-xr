"""Everything downloaded is listed in downloads.json; adding one is writing one entry."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import sys
import tarfile
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from helpers import ASSISTANT, ROOT, SRC


def _load():
    spec = importlib.util.spec_from_file_location("run_under_test", ROOT / "run.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


run = _load()


class Server:
    """Serves one body, honouring Range, so resuming can be tested without the network."""

    def __init__(self, body: bytes) -> None:
        outer = body

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self) -> None:  # noqa: N802
                start = 0
                header = self.headers.get("Range")
                if header:
                    start = int(re.match(r"bytes=(\d+)-", header).group(1))
                self.send_response(206 if header else 200)
                self.send_header("Content-Length", str(len(outer) - start))
                if header:
                    self.send_header("Content-Range", f"bytes {start}-{len(outer) - 1}/{len(outer)}")
                self.end_headers()
                self.wfile.write(outer[start:])

            def log_message(self, *args) -> None:
                return

        self.httpd = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}/file"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()


def _item(body: bytes, url: str, **extra) -> dict:
    return {
        "id": "t",
        "what": "test",
        "env": "VR_TEST_DOWNLOAD_PATH",
        "url": url,
        "to": "out/w.bin",
        "bytes": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
        **extra,
    }


class ListTest(unittest.TestCase):
    def setUp(self) -> None:
        self.items = json.loads((ROOT / "downloads.json").read_text(encoding="utf-8"))["items"]

    def test_every_entry_is_pinned_and_stays_inside_the_project(self) -> None:
        self.assertGreater(len(self.items), 0)
        self.assertEqual(len({item["id"] for item in self.items}), len(self.items))
        for item in self.items:
            self.assertTrue(item["url"].startswith("https://"), item["id"])
            self.assertRegex(item["sha256"], r"^[0-9a-f]{64}$")
            self.assertGreater(item["bytes"], 0)
            destination = Path(item["to"])
            self.assertFalse(destination.is_absolute(), item["id"])
            self.assertNotIn("..", destination.parts, item["id"])
            if item.get("unpack"):
                self.assertTrue(item["needs"], item["id"])
            if "env" in item:
                self.assertTrue(item["env"].startswith("VR_"), item["id"])

    def test_the_assistant_looks_for_what_is_downloaded(self) -> None:
        catalog = (ASSISTANT / "models/catalog.py").read_text(encoding="utf-8")
        by_id = {item["id"]: item for item in self.items}
        for name in ("llm", "stt", "voice-vi"):
            item = by_id[name]
            self.assertIn(Path(item["to"]).name, catalog)
            self.assertIn(item["env"], catalog)

    def test_the_hand_model_is_fetched_to_where_the_page_loads_it(self) -> None:
        item = next(item for item in self.items if item["id"] == "hand-landmarker")
        config = (SRC / "core/config.ts").read_text(encoding="utf-8")
        self.assertEqual(item["to"], "public/models/hand_landmarker.task")
        self.assertIn("models/hand_landmarker.task", config)
        self.assertNotIn("CORE_MODELS", (ASSISTANT / "frontend.py").read_text(encoding="utf-8"))


class WhereItLivesTest(unittest.TestCase):
    def test_the_list_belongs_to_the_project_and_needs_no_code_of_its_own(self) -> None:
        self.assertTrue((ROOT / "downloads.json").is_file())
        for stray in ("downloads.py", "assistant/downloads.json", "assistant/downloads.py"):
            self.assertFalse((ROOT / stray).exists(), stray)

    def test_run_py_fetches_after_the_packages_and_before_the_server(self) -> None:
        source = (ROOT / "run.py").read_text(encoding="utf-8")
        main = source[source.index("def main()") :]
        self.assertLess(main.index("_ensure_packages()"), main.index("_ensure_downloads()"))
        self.assertLess(main.index("_ensure_downloads()"), main.index("_start_server()"))

    def test_run_py_knows_no_file_by_name(self) -> None:
        source = (ROOT / "run.py").read_text(encoding="utf-8")
        for name in ("gguf", "ggml", "hand_landmarker", "piper", "huggingface", "qwen"):
            self.assertNotIn(name, source.lower())


@unittest.skipUnless(shutil.which("curl"), "needs curl")
class FetchTest(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.original = run.ROOT
        run.ROOT = Path(self.dir.name)
        self.addCleanup(lambda: setattr(run, "ROOT", self.original))
        self.out = run.ROOT / "out"
        self.body = bytes(range(256)) * 4000

    def test_a_file_that_is_already_there_is_left_alone(self) -> None:
        self.out.mkdir()
        (self.out / "w.bin").write_bytes(self.body)
        run._ensure_downloads([_item(self.body, "http://127.0.0.1:1/never")])
        self.assertEqual((self.out / "w.bin").read_bytes(), self.body)

    def test_a_truncated_file_is_not_mistaken_for_a_whole_one(self) -> None:
        self.out.mkdir()
        (self.out / "w.bin").write_bytes(self.body[:100])
        self.assertFalse(run._present(_item(self.body, "x"), self.out / "w.bin"))

    def test_a_missing_file_is_downloaded_checked_and_put_in_place(self) -> None:
        server = Server(self.body)
        self.addCleanup(server.close)
        run._ensure_downloads([_item(self.body, server.url)])
        self.assertEqual((self.out / "w.bin").read_bytes(), self.body)
        self.assertFalse((self.out / "w.bin.part").exists())

    def test_a_download_that_was_cut_off_carries_on_where_it_stopped(self) -> None:
        server = Server(self.body)
        self.addCleanup(server.close)
        self.out.mkdir()
        (self.out / "w.bin.part").write_bytes(self.body[:50_000])
        run._ensure_downloads([_item(self.body, server.url)])
        self.assertEqual((self.out / "w.bin").read_bytes(), self.body)

    def test_a_file_that_fails_its_checksum_is_thrown_away(self) -> None:
        server = Server(self.body)
        self.addCleanup(server.close)
        item = _item(self.body, server.url)
        item["sha256"] = "0" * 64
        run._ensure_downloads([item])
        self.assertFalse((self.out / "w.bin").exists())
        self.assertFalse((self.out / "w.bin.part").exists())

    def test_a_failed_download_does_not_stop_the_others(self) -> None:
        server = Server(self.body)
        self.addCleanup(server.close)
        broken = _item(self.body, "http://127.0.0.1:1/unreachable")
        second = _item(self.body, server.url, id="u", to="out/second.bin", env="VR_TEST_OTHER_PATH")
        run._ensure_downloads([broken, second])
        self.assertTrue((self.out / "second.bin").exists())
        self.assertFalse((self.out / "w.bin").exists())

    def test_a_path_the_user_set_is_never_fetched(self) -> None:
        os.environ["VR_TEST_DOWNLOAD_PATH"] = "somewhere/else.bin"
        self.addCleanup(os.environ.pop, "VR_TEST_DOWNLOAD_PATH", None)
        server = Server(self.body)
        self.addCleanup(server.close)
        run._ensure_downloads([_item(self.body, server.url)])
        self.assertFalse((self.out / "w.bin").exists())

    def test_an_entry_without_env_is_always_checked(self) -> None:
        server = Server(self.body)
        self.addCleanup(server.close)
        item = _item(self.body, server.url)
        del item["env"]
        run._ensure_downloads([item])
        self.assertTrue((self.out / "w.bin").exists())

    def test_an_archive_is_unpacked_whole_and_nothing_else_is_left(self) -> None:
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w:bz2") as archive:
            for name, data in (("v/a.onnx", b"model"), ("v/tokens.txt", b"t"), ("v/espeak-ng-data/x", b"d")):
                info = tarfile.TarInfo(name)
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        body = buffer.getvalue()
        server = Server(body)
        self.addCleanup(server.close)
        item = _item(body, server.url, to="out/v", unpack="tar", needs=["a.onnx", "tokens.txt", "espeak-ng-data"])
        run._ensure_downloads([item])
        self.assertTrue(run._present(item, self.out / "v"))
        self.assertEqual(sorted(path.name for path in self.out.iterdir()), ["v"])

    def test_an_archive_missing_what_the_entry_needs_is_not_kept(self) -> None:
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
            info = tarfile.TarInfo("v/a.onnx")
            info.size = 1
            archive.addfile(info, io.BytesIO(b"x"))
        body = buffer.getvalue()
        server = Server(body)
        self.addCleanup(server.close)
        run._ensure_downloads([_item(body, server.url, to="out/v", unpack="tar", needs=["a.onnx", "tokens.txt"])])
        self.assertFalse((self.out / "v").exists())
        self.assertEqual([path.name for path in self.out.iterdir()], [])


if __name__ == "__main__":
    unittest.main()
