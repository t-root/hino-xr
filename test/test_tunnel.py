"""The public address of the gpu profile: `run.py` opens a Cloudflare quick tunnel so a rented server that opens no port can still be reached."""

from __future__ import annotations

import importlib
import importlib.util
import json
import os
import sys
import unittest

from helpers import ASSISTANT, ROOT

sys.path.insert(0, str(ASSISTANT))
profiles = importlib.import_module("profiles")
sys.path.remove(str(ASSISTANT))

spec = importlib.util.spec_from_file_location("run_for_tests", ROOT / "run.py")
run = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run)


class TunnelTest(unittest.TestCase):
    def setUp(self) -> None:
        self.saved = {key: os.environ.get(key) for key in ("VR_TUNNEL", "VR_PROFILE")}
        os.environ["VR_PROFILE"] = "gpu"  # the tunnel belongs to the gpu profile

    def tearDown(self) -> None:
        for key, value in self.saved.items():
            os.environ.pop(key, None)
            if value is not None:
                os.environ[key] = value

    def test_the_tunnel_is_on_unless_switched_off(self) -> None:
        os.environ.pop("VR_TUNNEL", None)
        self.assertTrue(profiles.tunnel())
        for value in ("off", "0", "false", "no"):
            os.environ["VR_TUNNEL"] = value
            self.assertFalse(profiles.tunnel(), value)

    def test_the_cpu_profile_opens_no_tunnel(self) -> None:
        os.environ["VR_PROFILE"] = "cpu"
        os.environ["VR_TUNNEL"] = "on"
        self.assertFalse(profiles.tunnel())

    def test_the_address_is_found_in_the_programs_output(self) -> None:
        line = "2026-11-26T10:00:00Z INF |  https://quiet-river-1234.trycloudflare.com                |"
        self.assertEqual(run.TUNNEL_ADDRESS.search(line).group(0), "https://quiet-river-1234.trycloudflare.com")
        self.assertIsNone(run.TUNNEL_ADDRESS.search("INF Requesting new quick Tunnel on trycloudflare.com..."))

    def test_the_program_is_downloaded_pinned_like_every_other(self) -> None:
        items = {item["id"]: item for item in json.loads((ROOT / "downloads.json").read_text(encoding="utf-8"))["items"]}
        item = items["bin-cloudflared"]
        self.assertEqual(item["profile"], ["gpu"])
        self.assertEqual(ROOT / item["to"], run.CLOUDFLARED)
        self.assertRegex(item["sha256"], r"^[0-9a-f]{64}$")
        self.assertGreater(item["bytes"], 1_000_000)
        self.assertNotIn("/latest/", item["url"])  # a version, not whatever is newest

    def test_the_gpu_server_listens_on_this_machine_only_and_speaks_plain_http(self) -> None:
        self.assertEqual(profiles.host(), "127.0.0.1")
        self.assertFalse(profiles.https())  # the tunnel is the HTTPS; no certificate to trust on the phone

    def test_the_cpu_server_listens_on_the_network_with_a_certificate(self) -> None:
        os.environ["VR_PROFILE"] = "cpu"
        self.assertEqual(profiles.host(), "0.0.0.0")
        self.assertTrue(profiles.https())

    def test_main_takes_both_from_the_profile(self) -> None:
        main = (ROOT / "assistant" / "main.py").read_text(encoding="utf-8")
        self.assertIn("HOST = profiles.host()", main)
        self.assertIn("profiles.https()", main)

    def test_run_opens_the_tunnel_before_it_serves_and_closes_it_after(self) -> None:
        source = (ROOT / "run.py").read_text(encoding="utf-8")
        self.assertLess(source.index("    _start_tunnel()\n    try:"), source.index("        _start_server()"))
        self.assertIn("finally:\n        _stop_tunnel()", source)


if __name__ == "__main__":
    unittest.main()
