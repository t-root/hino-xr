#!/usr/bin/env python3
"""Start VR Core: install missing packages, free port 5173, run the server (gpu profile: and open its public tunnel address)."""

from __future__ import annotations

import atexit
import hashlib
import json
import os
import re
import runpy
import shutil
import socket
import subprocess
import sys
import tarfile
import threading
import time
import traceback
import zipfile
from pathlib import Path

PORT = 5173
ROOT = Path(__file__).resolve().parent
ASSISTANT = ROOT / "assistant"
REQUIREMENTS = ROOT / "requirements.txt"
DOWNLOADS = ROOT / "downloads.json"
CLOUDFLARED = ROOT / "assistant" / "bin" / "cloudflared" / ("cloudflared.exe" if sys.platform == "win32" else "cloudflared")
TUNNEL_ADDRESS = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com", re.I)
PACKAGES = (
    "fastapi",
    "uvicorn",
    "pyttsx3",
    "vieneu",
    "librosa",
    "soundfile",
)
CPU_PACKAGES = ("cryptography",)  # the self-signed certificate of the cpu profile; the gpu profile's HTTPS is the tunnel's
VIENEU = "vieneu==3.8.3"
MIN_PYTHON = (3, 11)

sys.path.insert(0, str(ASSISTANT))
import profiles  # noqa: E402 - standard library only, so it is read before anything is installed


def _configure_stdio() -> None:
    os.chdir(ROOT)
    if sys.platform != "win32":
        return
    system_root = os.environ.get("SystemRoot", r"C:\Windows")
    os.environ["PATH"] = str(Path(system_root) / "System32") + os.pathsep + os.environ.get("PATH", "")
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass
    try:
        import ctypes

        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        ctypes.windll.kernel32.SetConsoleTitleW("VR Core")
    except (AttributeError, OSError):
        pass


def _say(message: str = "") -> None:
    print(message, flush=True)


def _packages_ok() -> bool:
    for name in PACKAGES + (() if profiles.is_gpu() else CPU_PACKAGES):
        try:
            __import__(name)
        except ImportError:
            return False
    return True


def _ensure_packages() -> bool:
    _say("Kiem tra thu vien Python...")
    if _packages_ok():
        _say("Thu vien Python da co, bo qua pip.")
        _say()
        return True
    _say("Dang cai thu vien Python...")
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", "-r", str(REQUIREMENTS)],
        cwd=ROOT,
    )
    if result.returncode == 0:
        # Its own list of requirements names gradio, which is large and never used here.
        result = subprocess.run([sys.executable, "-m", "pip", "install", "--no-deps", VIENEU], cwd=ROOT)
    if result.returncode == 0 and _packages_ok():
        _say()
        return True
    _say()
    _say("[LOI] pip install that bai. Kiem tra mang roi chay lai.")
    _say()
    return False


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _present(item: dict, dest: Path) -> bool:
    if item.get("unpack"):
        return dest.is_dir() and all(any(dest.rglob(name)) for name in item["needs"])
    return dest.is_file() and dest.stat().st_size == item["bytes"]


def _fetch(item: dict, dest: Path) -> None:
    """curl (resumes a cut-off download), check the SHA-256, then put it in place, unpacking an archive."""
    part = dest.with_name(dest.name + ".part")
    part.parent.mkdir(parents=True, exist_ok=True)
    if not (part.is_file() and part.stat().st_size == item["bytes"]):
        subprocess.run(["curl", "-L", "--fail", "-C", "-", "--progress-bar", "-o", str(part), item["url"]], check=True)
    if _sha256(part) != item["sha256"]:
        part.unlink()
        raise ValueError("sha256 khong khop, da xoa file tai ve")
    if not item.get("unpack"):
        part.replace(dest)
        return
    stage = dest.with_name(dest.name + ".unpack")
    shutil.rmtree(stage, ignore_errors=True)
    stage.mkdir(parents=True)
    if item.get("flat"):
        # A zip of programs: its files go straight into `to`, next to the ones another zip put there.
        try:
            with zipfile.ZipFile(part) as archive:
                if any(Path(name).is_absolute() or ".." in Path(name).parts for name in archive.namelist()):
                    raise ValueError("goi tai ve co duong dan la")
                archive.extractall(stage)
            if not all(any(stage.rglob(name)) for name in item["needs"]):
                raise ValueError("goi tai ve thieu file")
            shutil.copytree(stage, dest, dirs_exist_ok=True)
        finally:
            shutil.rmtree(stage, ignore_errors=True)
            part.unlink(missing_ok=True)
        return
    try:
        with tarfile.open(part) as archive:  # not tar.exe: Windows' one hangs on .bz2
            if any(Path(m.name).is_absolute() or ".." in Path(m.name).parts for m in archive.getmembers()):
                raise ValueError("goi tai ve co duong dan la")
            archive.extractall(stage)
        if not all((stage / dest.name / name).exists() for name in item["needs"]):
            raise ValueError("goi tai ve thieu file")
        shutil.rmtree(dest, ignore_errors=True)
        (stage / dest.name).replace(dest)
    finally:
        shutil.rmtree(stage, ignore_errors=True)
        part.unlink(missing_ok=True)


def _ensure_downloads(items: list | None = None) -> None:
    """Every file in downloads.json that is not on disk yet. To fetch something else, add an entry there."""
    _say("Kiem tra cac file can tai...")
    sys.path.insert(0, str(ASSISTANT))
    try:
        import models.catalog  # noqa: F401 - reads assistant/.env, which may name a file of the user's own
    except Exception:  # noqa: BLE001
        pass
    for item in json.loads(DOWNLOADS.read_text(encoding="utf-8"))["items"] if items is None else items:
        if not profiles.wanted(item):
            continue  # an entry of the other profile: nothing to say about it
        dest, name = ROOT / item["to"], item["what"]
        when = item.get("when")
        if when and os.environ.get(when["env"], "").strip().lower() != str(when["equals"]).lower():
            continue  # only fetched when asked for (a big optional model): nothing to say about it
        if os.environ.get(item.get("env", ""), "").strip():
            _say(f"  {name}: dung duong dan rieng ({item['env']}), khong tai.")
        elif _present(item, dest):
            _say(f"  {name}: da co, bo qua.")
        else:
            _say(f"  {name}: dang tai ({item['bytes'] >> 20} MB)...")
            try:
                _fetch(item, dest)
            except (OSError, ValueError, subprocess.CalledProcessError) as error:
                _say(f"  [LOI] {name}: {error}. Kiem tra mang roi chay lai, phan tai do dang se duoc tiep tuc.")
    _say()


def _pids_on_port(port: int) -> list[int]:
    self_pid = os.getpid()
    if sys.platform == "win32":
        return _pids_windows(port, self_pid)
    return _pids_unix(port, self_pid)


def _pids_windows(port: int, self_pid: int) -> list[int]:
    try:
        output = subprocess.check_output(
            ["netstat", "-ano", "-p", "TCP"],
            text=True,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return []
    found: list[int] = []
    suffix = f":{port}"
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 5 or "LISTENING" not in parts:
            continue
        local = parts[1]
        if not (local.endswith(suffix) or local.endswith(f"]{suffix}")):
            continue
        try:
            pid = int(parts[-1])
        except ValueError:
            continue
        if pid not in {0, self_pid} and pid not in found:
            found.append(pid)
    return found


def _pids_unix(port: int, self_pid: int) -> list[int]:
    try:
        output = subprocess.check_output(
            ["lsof", "-ti", f"TCP:{port}"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return []
    found: list[int] = []
    for token in output.split():
        try:
            pid = int(token)
        except ValueError:
            continue
        if pid not in {0, self_pid} and pid not in found:
            found.append(pid)
    return found


def _kill_pid(pid: int) -> None:
    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/F"],
            capture_output=True,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return
    try:
        os.kill(pid, 15)
    except OSError:
        pass


def _free_port(port: int) -> bool:
    killed = False
    for _ in range(10):
        pids = _pids_on_port(port)
        if not pids:
            return killed
        killed = True
        for pid in pids:
            _kill_pid(pid)
        time.sleep(1)
    _say(f"[LOI] Cong {port} van bi giu sau 10 lan thu.")
    _say("Dong cac cua so VR Core cu roi chay lai.")
    _say()
    raise SystemExit(1)


def _notes(killed: bool) -> None:
    gpu = profiles.is_gpu()
    if killed:
        if not gpu:
            os.environ["VR_OPEN_BROWSER"] = "0"
        _say(f"Da tat may chu cu dang giu cong {PORT}.")
        if not gpu:
            _say("Tab cu van dung duoc - khong mo them cua so trinh duyet.")
        _say()
    elif not gpu:
        _say(f"Dang mo https://127.0.0.1:{PORT}")
        _say()
    _say(f"Ho so: {profiles.name()} (VR_PROFILE=cpu hoac gpu).")
    _say("Luu y:")
    if gpu:
        _say("  - May chu nay khong mo cong ra ngoai. No tu mo mot tunnel Cloudflare va in ra dia chi https://...trycloudflare.com")
        _say("    (kem ?key=...): mo dia chi do tren dien thoai, o dau cung duoc. Dia chi moi lan chay la mot dia chi moi.")
        _say("    Giu kin dia chi co ?key=. VR_TUNNEL=off de khong mo tunnel (chi dung duoc tren chinh may nay).")
    else:
        _say("  - Camera can HTTPS. Tren dien thoai mo https:// (chu s) roi")
        _say(f"    dia chi may, vi du https://192.168.x.x:{PORT}")
        _say("    Mo bang http:// thi trinh duyet chan camera.")
        _say("  - Lan dau trinh duyet canh bao giay chung nhan: chon Advanced")
        _say("    / Proceed / Tiep tuc, roi tai lai.")
    _say("  - Lan dau can mang de tai Three.js, MediaPipe va mo hinh thi giac.")
    _say("    Tai xong roi thi nhung lan sau chay duoc ca khi khong co mang.")
    _say(f"  - Lan dau se tu tai model va may chu AI (xem downloads.json), khoang {'17' if gpu else '6'} GB, co the mat nhieu phut.")
    _say("  - May chu AI (llama.cpp, whisper.cpp) chay tren may nay, cau hinh o assistant/ai/stages.<ho so>.json.")
    _say("    Muon dung API ben ngoai cho mot viec: dat VR_<VIEC>_URL va VR_<VIEC>_KEY trong assistant/.env.")
    _say("  - Bam Ctrl+C de dung may chu.")
    _say()


# ---- the public address -------------------------------------------------------------------------------------------
# A rented server opens no port, so `cloudflared` (downloads.json) dials out to Cloudflare and gets back an
# https://....trycloudflare.com address that reaches this page from anywhere. It is HTTPS, which the phone's camera needs,
# so the server itself is plain HTTP on 127.0.0.1. The address is new at every start. `VR_TUNNEL=off` opens none.
_tunnel: subprocess.Popen[bytes] | None = None


def _page_is_up() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", PORT), timeout=0.5):
            return True
    except OSError:
        return False


def _show_address(address: str) -> None:
    sys.path.insert(0, str(ASSISTANT))
    import ai.config  # noqa: F401 - reads assistant/.env, which may fix the key (VR_ACCESS_TOKEN)
    import access  # the key is the one the server asks for; it is on while there is a public address

    suffix = "/?key=%s" % access.token() if access.enabled() else ""
    _say()
    _say("VR Core  dia chi cong khai (HTTPS, mo duoc o dau cung duoc):")
    _say(f"         {address}{suffix}")
    if suffix:
        _say("         Dien thoai can phan ?key= o lan dau, sau do tu nho. Giu kin dia chi nay.")
    _say("         Moi lan chay la mot dia chi moi.")
    _say()


def _run_tunnel() -> None:
    global _tunnel
    if not CLOUDFLARED.is_file():
        _say(f"  tunnel   khong co {CLOUDFLARED.name} trong {CLOUDFLARED.parent}: chay lai run.py de tai.")
        return
    deadline = time.monotonic() + 120
    while not _page_is_up():  # the server starts after this thread does
        if time.monotonic() > deadline:
            _say(f"  tunnel   trang khong mo cong {PORT}, nen khong mo tunnel.")
            return
        time.sleep(0.4)
    try:
        # --no-autoupdate: the version is the one downloads.json pinned, not whatever is newest.
        _tunnel = subprocess.Popen(
            [str(CLOUDFLARED), "tunnel", "--no-autoupdate", "--url", f"http://127.0.0.1:{PORT}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except OSError as error:
        _say(f"  tunnel   khong chay duoc {CLOUDFLARED.name}: {error}")
        return
    shown = False
    for raw in iter(_tunnel.stdout.readline, b""):  # type: ignore[union-attr]
        match = TUNNEL_ADDRESS.search(raw.decode("utf-8", "replace"))
        if match and not shown:
            shown = True
            _show_address(match.group(0))
    if not shown:
        _say("  tunnel   tunnel dung truoc khi co dia chi (mang co dang hoat dong khong?)")


def _stop_tunnel() -> None:
    global _tunnel
    proc, _tunnel = _tunnel, None
    if proc is not None and proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def _start_tunnel() -> None:
    if not profiles.tunnel():
        if profiles.is_gpu():
            _say("VR_TUNNEL=off: khong mo dia chi cong khai. Trang chi mo duoc tren may nay, o http://127.0.0.1:%d" % PORT)
            _say()
        return
    atexit.register(_stop_tunnel)
    threading.Thread(target=_run_tunnel, daemon=True, name="tunnel").start()


def _start_server() -> None:
    sys.path.insert(0, str(ASSISTANT))
    runpy.run_path(str(ASSISTANT / "main.py"), run_name="__main__")


def _wait_before_close() -> None:
    if len(sys.argv) > 1 and sys.argv[1] in {"test", "--test"}:
        return
    if not sys.stdin.isatty():
        return
    try:
        input("Nhan Enter de dong...")
    except EOFError:
        pass


def _run_tests() -> int:
    import unittest

    _say("Chay test Python (khong Node.js)...")
    _say()
    loader = unittest.defaultTestLoader
    suite = loader.discover(str(ROOT / "test"), pattern="test_*.py")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


def main() -> int:
    _configure_stdio()
    if len(sys.argv) > 1 and sys.argv[1] in {"test", "--test"}:
        return _run_tests()
    _say("================================================")
    _say("  VR Core - may chu Python")
    _say("================================================")
    _say()
    if sys.version_info < MIN_PYTHON:
        _say(f"[LOI] Can Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]} tro len (dang la {sys.version.split()[0]}).")
        _say("Cai o https://www.python.org roi chay lai bang py -3.11 run.py.")
        _say()
        return 1
    try:
        profiles.load_env()  # assistant/.env may set VR_PROFILE
        profiles.name()
    except ValueError as error:
        _say(f"[LOI] {error}")
        _say()
        return 1
    if not _ensure_packages():
        return 1
    _ensure_downloads()
    killed = _free_port(PORT)
    _notes(killed)
    _start_tunnel()
    try:
        _start_server()
    except KeyboardInterrupt:
        _say()
    finally:
        _stop_tunnel()
    _say()
    _say("May chu da dung.")
    return 0


if __name__ == "__main__":
    code = 1
    try:
        code = main()
    except SystemExit as error:
        code = error.code if isinstance(error.code, int) else 1
    except Exception:
        traceback.print_exc()
        code = 1
    finally:
        _wait_before_close()
    raise SystemExit(code)
