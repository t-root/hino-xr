from pathlib import Path
import os
import sys
import webbrowser
from threading import Timer

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

if sys.platform == "win32":
    import asyncio

    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

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
    Timer(1.2, _open_browser).start()
    uvicorn.run(
        "app:app",
        host=HOST,
        port=PORT,
        ssl_certfile=str(cert),
        ssl_keyfile=str(key),
        reload=False,
    )
