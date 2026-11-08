from pathlib import Path
import os
import sys
import webbrowser
from threading import Thread, Timer

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import asyncio

import uvicorn

from frontend import ensure_cert, lan_ips, prepare_frontend

PORT = 5173
HOST = "0.0.0.0"


def _open_browser() -> None:
    flag = os.environ.get("VR_OPEN_BROWSER", "1").strip().lower()
    if flag in {"0", "false", "no"}:
        return
    webbrowser.open("https://127.0.0.1:%s" % PORT)


def _announce() -> None:
    print()
    print("VR Core  https://127.0.0.1:%s" % PORT)
    for ip in lan_ips():
        if ip != "127.0.0.1":
            print("          https://%s:%s  (phone, same Wi-Fi)" % (ip, PORT))
    print()
    print("Camera needs HTTPS. First visit: Advanced / Proceed, then reload.")
    print("Ctrl+C stops the server.")
    print()


if __name__ == "__main__":
    prepare_frontend()
    cert, key = ensure_cert()
    _announce()
    from models.speech import speech

    Thread(target=speech.warm, daemon=True).start()
    Timer(1.2, _open_browser).start()
    server = uvicorn.Server(
        uvicorn.Config(
            "app:app",
            host=HOST,
            port=PORT,
            ssl_certfile=str(cert),
            ssl_keyfile=str(key),
            reload=False,
        )
    )
    if sys.platform == "win32":
        # uvicorn picks Windows' proactor loop on its own, whatever the event loop policy says, and that loop
        # prints a traceback ("WinError 10054") every time a browser drops a connection, as it does on every
        # page reload. The selector loop does not, and is what this server has always been meant to run on.
        loop = asyncio.SelectorEventLoop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(server.serve())
    else:
        server.run()
