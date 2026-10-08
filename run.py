#!/usr/bin/env python3
"""Start VR Core: install missing packages, free port 5173, run the HTTPS server."""

from __future__ import annotations

import hashlib
import json
import os
import runpy
import shutil
import subprocess
import sys
import tarfile
import time
import traceback
from pathlib import Path

PORT = 5173
ROOT = Path(__file__).resolve().parent
ASSISTANT = ROOT / "assistant"
REQUIREMENTS = ROOT / "requirements.txt"
DOWNLOADS = ROOT / "downloads.json"
PACKAGES = (
    "fastapi",
    "uvicorn",
    "cryptography",
    "llama_cpp",
    "pywhispercpp",
    "pyttsx3",
    "sherpa_onnx",
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


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _present(item: dict, dest: Path) -> bool:
    if item.get("unpack"):
        return dest.is_dir() and all((dest / name).exists() for name in item["needs"])
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
        dest, name = ROOT / item["to"], item["what"]
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
    _say("  - Lan dau se tu tai model (xem downloads.json), co the mat vai phut.")
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
    _ensure_downloads()
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
