#!/usr/bin/env python3
"""Start VR Core: install missing packages, free port 5173, run the HTTPS server."""

from __future__ import annotations

import os
import runpy
import subprocess
import sys
import time
import traceback
from pathlib import Path

PORT = 5173
ROOT = Path(__file__).resolve().parent
ASSISTANT = ROOT / "assistant"
REQUIREMENTS = ASSISTANT / "requirements.txt"
PACKAGES = (
    "fastapi",
    "uvicorn",
    "cryptography",
    "llama_cpp",
    "pywhispercpp",
    "pyttsx3",
)


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
    for name in PACKAGES:
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
    if result.returncode == 0 and _packages_ok():
        _say()
        return True
    _say()
    _say("[LOI] pip install that bai.")
    _say("llama-cpp-python can wheel CPU, khong bien dich. Kiem tra mang")
    _say("roi chay lai. Khong cai Visual Studio chi de mo ung dung.")
    _say()
    return False


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
    if killed:
        os.environ["VR_OPEN_BROWSER"] = "0"
        _say(f"Da tat may chu cu dang giu cong {PORT}.")
        _say("Tab cu van dung duoc - khong mo them cua so trinh duyet.")
        _say()
    else:
        _say(f"Dang mo https://127.0.0.1:{PORT}")
        _say()
    _say("Luu y:")
    _say("  - Camera can HTTPS. Tren dien thoai mo https:// (chu s) roi")
    _say(f"    dia chi may, vi du https://192.168.x.x:{PORT}")
    _say("    Mo bang http:// thi trinh duyet chan camera.")
    _say("  - Lan dau trinh duyet canh bao giay chung nhan: chon Advanced")
    _say("    / Proceed / Tiep tuc, roi tai lai.")
    _say("  - Lan dau can mang de tai Three.js, MediaPipe va mo hinh thi giac.")
    _say("    Tai xong roi thi nhung lan sau chay duoc ca khi khong co mang.")
    _say("  - Dat file .gguf vao assistant/weights/ (xem assistant/.env.example)")
    _say("  - Bam Ctrl+C de dung may chu.")
    _say()


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
    if not _ensure_packages():
        return 1
    killed = _free_port(PORT)
    _notes(killed)
    try:
        _start_server()
    except KeyboardInterrupt:
        _say()
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
