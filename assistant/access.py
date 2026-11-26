"""Who may use the `/api`.

The server listens on the whole network so a phone can reach it, and what is behind `/api` is worth
protecting: it installs and runs plugins an AI wrote, spends an API key, and holds the faces and
names of the people the headset knows. So:

- The computer's own browser (loopback) needs nothing.
- Anything else, the phone included, must send the access key in the `X-Access-Key` header. The key is
  `VR_ACCESS_TOKEN` or, when that is not set, a random one made on the first run and kept in
  `assistant/data/access.key`. The address printed at start-up carries it (`?key=...`); the page keeps it
  in the browser and sends it from then on.
- A request that says it comes from another website (an `Origin` that is not this server) is refused,
  loopback included, so a page open in the computer's browser cannot drive the assistant.
- `/api/health` and the page itself are open: the page has to load before it can show the key.

The key check follows the profile (`profiles.py`). cpu: OFF by default, so a phone on the same Wi-Fi just opens the
address. gpu: ON while there is a public address (the tunnel `run.py` opens), because anyone who finds the address could
otherwise drive the assistant; OFF with `VR_TUNNEL=off`, and the page is this machine's alone.
`VR_ACCESS=on` or `off` decides it by hand (everything above then applies); the website check stays either way.

Everything that comes in through the tunnel is made by `cloudflared` on this machine, so it connects from 127.0.0.1.
It is told apart by the headers Cloudflare adds (`Cf-Connecting-Ip`, `X-Forwarded-For`): a request that has one is
not the computer's own browser, and needs the key like any other device.
"""

from __future__ import annotations

import hmac
import json
import os
import secrets
from pathlib import Path
from urllib.parse import urlsplit

import profiles

KEY_FILE = Path(__file__).resolve().parent / "data" / "access.key"
HEADER = b"x-access-key"
FROM_TUNNEL = (b"cf-connecting-ip", b"x-forwarded-for")
OPEN_PATHS = {"/api/health"}
LOOPBACK = {"127.0.0.1", "::1", "localhost"}

_token: str | None = None


def token() -> str:
    """The access key: from the environment, else the saved one, else a new random one that is saved."""
    global _token
    if _token:
        return _token
    given = os.environ.get("VR_ACCESS_TOKEN", "").strip()
    if given:
        _token = given
        return _token
    try:
        saved = KEY_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        saved = ""
    if not saved:
        saved = secrets.token_urlsafe(24)
        try:
            KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
            KEY_FILE.write_text(saved + "\n", encoding="utf-8")
        except OSError:
            pass  # not saved: the key lasts until the server stops, and the next start prints a new one
    _token = saved
    return _token


def reset() -> None:
    """Forget the key held in memory. Used by tests."""
    global _token
    _token = None


def enabled() -> bool:
    default = "on" if profiles.tunnel() else "off"
    return os.environ.get("VR_ACCESS", default).strip().lower() in {"on", "1", "true", "yes"}


def _refuse(status: int, detail: str):
    body = json.dumps({"detail": detail}).encode("utf-8")

    async def respond(scope, receive, send) -> None:
        await send({"type": "http.response.start", "status": status, "headers": [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(body)).encode()),
            (b"cache-control", b"no-store"),
        ]})
        await send({"type": "http.response.body", "body": body})

    return respond


class AccessMiddleware:
    """Pure ASGI, so streamed replies (server-sent events) pass through untouched."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or not scope.get("path", "").startswith("/api/") or scope["path"] in OPEN_PATHS:
            await self.app(scope, receive, send)
            return
        headers = {name.lower(): value for name, value in scope.get("headers", [])}
        origin = headers.get(b"origin", b"").decode("latin-1")
        host = headers.get(b"host", b"").decode("latin-1")
        if origin and urlsplit(origin).netloc.lower() != host.lower():
            await _refuse(403, "request from another site")(scope, receive, send)
            return
        client = (scope.get("client") or ("", 0))[0]
        through_tunnel = any(name in headers for name in FROM_TUNNEL)
        if enabled() and (client not in LOOPBACK or through_tunnel):
            sent = headers.get(HEADER, b"").decode("latin-1")
            if not sent or not hmac.compare_digest(sent.encode(), token().encode()):
                await _refuse(401, "access key needed: open the address with ?key= that the server printed")(scope, receive, send)
                return
        await self.app(scope, receive, send)
