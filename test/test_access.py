"""The /api is for the computer's own browser and for devices that hold the key, and for nothing a web page can drive."""

from __future__ import annotations

import asyncio
import importlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

from helpers import ASSISTANT, SRC

sys.path.insert(0, str(ASSISTANT))
access = importlib.import_module("access")
sys.path.remove(str(ASSISTANT))

KEY = "k3y-for-tests"


def call(path: str, *, client: str = "192.168.1.20", headers: dict[str, str] | None = None) -> tuple[int, dict | None]:
    """Run one request through the middleware: (status, JSON body when it was refused), 200 when it got through."""
    seen: dict = {}

    async def app(scope, receive, send) -> None:
        seen["reached"] = True
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}"})

    scope = {
        "type": "http",
        "method": "POST",
        "path": path,
        "client": (client, 5000),
        "headers": [(k.lower().encode(), v.encode()) for k, v in {"host": "192.168.1.5:5173", **(headers or {})}.items()],
    }
    sent: list[dict] = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        sent.append(message)

    asyncio.run(access.AccessMiddleware(app)(scope, receive, send))
    status = sent[0]["status"]
    body = json.loads(sent[1]["body"]) if status != 200 else None
    return status, body


class AccessTest(unittest.TestCase):
    def setUp(self) -> None:
        self.saved = {k: os.environ.get(k) for k in ("VR_ACCESS_TOKEN", "VR_ACCESS")}
        os.environ["VR_ACCESS_TOKEN"] = KEY
        os.environ["VR_ACCESS"] = "on"  # off is the default; these tests are about the key being required
        access.reset()

    def tearDown(self) -> None:
        for key, value in self.saved.items():
            os.environ.pop(key, None)
            if value is not None:
                os.environ[key] = value
        access.reset()

    def test_a_device_on_the_network_without_the_key_is_turned_away(self) -> None:
        status, body = call("/api/plugins/x/approve")
        self.assertEqual(status, 401)
        self.assertIn("key", body["detail"])

    def test_a_wrong_key_is_turned_away(self) -> None:
        self.assertEqual(call("/api/people", headers={"X-Access-Key": "nope"})[0], 401)
        self.assertEqual(call("/api/people", headers={"X-Access-Key": KEY[:-1]})[0], 401)

    def test_the_right_key_gets_in(self) -> None:
        self.assertEqual(call("/api/people", headers={"X-Access-Key": KEY})[0], 200)

    def test_the_computers_own_browser_needs_no_key(self) -> None:
        for host in ("127.0.0.1", "::1"):
            self.assertEqual(call("/api/people", client=host)[0], 200)

    def test_the_page_and_the_health_check_are_open(self) -> None:
        self.assertEqual(call("/")[0], 200)
        self.assertEqual(call("/app.js")[0], 200)
        self.assertEqual(call("/api/health")[0], 200)

    def test_a_request_from_another_website_is_refused_even_on_the_computer(self) -> None:
        evil = {"Origin": "https://evil.example"}
        self.assertEqual(call("/api/plugins/x/approve", client="127.0.0.1", headers=evil)[0], 403)
        self.assertEqual(call("/api/plugins/x/approve", headers={**evil, "X-Access-Key": KEY})[0], 403)

    def test_this_servers_own_page_is_not_another_website(self) -> None:
        own = {"Origin": "https://192.168.1.5:5173", "X-Access-Key": KEY}
        self.assertEqual(call("/api/people", headers=own)[0], 200)

    def test_the_key_check_is_off_by_default(self) -> None:
        os.environ.pop("VR_ACCESS")
        self.assertFalse(access.enabled())
        self.assertEqual(call("/api/people")[0], 200)
        self.assertEqual(call("/api/people", headers={"Origin": "https://evil.example"})[0], 403)  # the site check stays

    def test_a_key_is_made_once_and_kept(self) -> None:
        os.environ.pop("VR_ACCESS_TOKEN")
        keep = access.KEY_FILE
        with tempfile.TemporaryDirectory() as folder:
            access.KEY_FILE = Path(folder) / "data" / "access.key"
            try:
                access.reset()
                first = access.token()
                self.assertGreaterEqual(len(first), 24)
                access.reset()
                self.assertEqual(access.token(), first)  # after a restart it is the same, so a phone stays signed in
            finally:
                access.KEY_FILE = keep

    def test_the_page_sends_the_key_on_every_server_call(self) -> None:
        for relative in ("core/models/ModelClient.ts", "modules/face-recognition/peopleApi.ts"):
            self.assertIn("withAccessKey(", (SRC / relative).read_text(encoding="utf-8"), relative)
        self.assertIn("initAccessKey();", (SRC / "main.ts").read_text(encoding="utf-8"))

    def test_the_server_installs_the_check(self) -> None:
        self.assertIn("add_middleware(AccessMiddleware)", (ASSISTANT / "app.py").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
