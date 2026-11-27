from pathlib import Path
import os
import sys
import threading
import time
import webbrowser
from threading import Thread, Timer

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import asyncio

import uvicorn

import access
import profiles
from frontend import ensure_cert, lan_ips, prepare_frontend, watch_frontend

PORT = 5173
HOST = profiles.host()


def _open_browser() -> None:
    flag = os.environ.get("VR_OPEN_BROWSER", "1").strip().lower()
    if flag in {"0", "false", "no"}:
        return
    webbrowser.open("https://127.0.0.1:%s" % PORT)


def _announce() -> None:
    print()
    if profiles.is_gpu():
        print("VR Core  http://127.0.0.1:%s  (this machine only; run.py opens the public address)" % PORT)
        print("Ctrl+C stops the server.")
        print()
        return
    print("VR Core  https://127.0.0.1:%s" % PORT)
    suffix = "/?key=%s" % access.token() if access.enabled() else ""
    phone = [ip for ip in lan_ips() if ip != "127.0.0.1"][:1]
    for ip in phone:
        print("          https://%s:%s%s  (phone, same Wi-Fi)" % (ip, PORT, suffix))
    if suffix:
        print("          The phone needs the ?key= part the first time; it remembers it. Keep it private.")
    print()
    print("Camera needs HTTPS. First visit: Advanced / Proceed, then reload.")
    print("Ctrl+C stops the server.")
    print()


def _serve(tls: dict) -> None:
    import importlib

    import reloader

    app = importlib.import_module("app").app
    watch = reloader.Reloader() if reloader.enabled() else None
    while True:
        server = uvicorn.Server(uvicorn.Config(app, host=HOST, port=PORT, reload=False, timeout_graceful_shutdown=2, **tls))
        done = threading.Event()
        taken: list = []

        def watching() -> None:
            while not done.wait(1.0):
                changed = watch.poll()
                if not changed:
                    continue
                time.sleep(0.3)
                changed += watch.poll()
                fresh = watch.reload(changed)
                if fresh is not None:
                    taken.append(fresh)
                    server.should_exit = True
                    return

        if watch is not None:
            Thread(target=watching, daemon=True).start()
        try:
            if sys.platform == "win32":
                loop = asyncio.SelectorEventLoop()
                asyncio.set_event_loop(loop)
                loop.run_until_complete(server.serve())
                loop.close()
            else:
                server.run()
        finally:
            done.set()
        if not taken:
            return
        app = taken[0]
        print("  reload   server restarted on the new code", flush=True)


if __name__ == "__main__":
    esbuild = prepare_frontend()
    cert, key = ensure_cert() if profiles.https() else (None, None)
    _announce()
    from ai import servers
    from models.speech import speech

    servers.start_background()
    Thread(target=speech.warm, daemon=True).start()
    Thread(target=watch_frontend, args=(esbuild,), daemon=True).start()
    tls = {"ssl_certfile": str(cert), "ssl_keyfile": str(key)} if cert else {}
    if cert:
        Timer(1.2, _open_browser).start()
    _serve(tls)
