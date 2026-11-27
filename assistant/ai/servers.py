
from __future__ import annotations

import atexit
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from . import config

BIN = config.HERE.parent / "bin"
LOGS = config.HERE.parent / "data" / "logs"
HEALTH = {"llama": "/health", "whisper": "/"}
START_TIMEOUT_S = {"llama": 240.0, "whisper": 120.0}
WAIT_FOR_IDLE_S = 300.0
INFERENCE_PATH = "/v1/audio/transcriptions"


class ServerError(Exception):
    pass


_cond = threading.Condition()
_procs: dict[str, subprocess.Popen[bytes]] = {}
_active: dict[str, int] = {}
_last: dict[str, float] = {}
_start_locks: dict[str, threading.Lock] = {}
_reaper: threading.Thread | None = None
_atexit_set = False


def executable(kind: str) -> Path:
    folder = BIN / kind
    names = {"llama": "llama-server", "whisper": "whisper-server"}
    wanted = names[kind] + (".exe" if sys.platform == "win32" else "")
    found = next(iter(sorted(folder.rglob(wanted))), None) if folder.is_dir() else None
    if found is None:
        raise ServerError(f"{wanted} is not in {folder}: run run.py to download it")
    return found


def command(server_id: str, no_gpu: bool = False) -> list[str]:
    spec = config.servers()[server_id]
    model = config.path_of(spec["model"])
    if not model.is_file():
        raise ServerError(f"{model.name} is not in {model.parent}: run run.py to download it")
    exe = str(executable(spec["kind"]))
    if spec["kind"] == "llama":
        args = [
            exe, "-m", str(model), "--host", "127.0.0.1", "--port", str(spec["port"]),
            "-c", str(spec.get("ctx", 8192)), "-ngl", "0" if no_gpu else str(spec.get("gpu_layers", 99)),
            "-np", "1", "--jinja", "-a", str(spec.get("alias", server_id)),
        ]
        if spec.get("threads"):
            args += ["-t", str(spec["threads"])]
        if spec.get("image_max_tokens"):
            args += ["--image-max-tokens", str(spec["image_max_tokens"])]
        if spec.get("mmproj"):
            mmproj = config.path_of(spec["mmproj"])
            if not mmproj.is_file():
                raise ServerError(f"{mmproj.name} is not in {mmproj.parent}: run run.py to download it")
            args += ["--mmproj", str(mmproj)]
        return args
    args = [
        exe, "-m", str(model), "--host", "127.0.0.1", "--port", str(spec["port"]),
        "--inference-path", INFERENCE_PATH, "-t", str(spec.get("threads", min(8, os.cpu_count() or 4))),
    ]
    return [*args, "-ng"] if no_gpu else args


def _healthy(server_id: str) -> bool:
    spec = config.servers()[server_id]
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{spec['port']}{HEALTH[spec['kind']]}", timeout=2) as response:
            return response.status == 200
    except (urllib.error.URLError, OSError, ValueError):
        return False


def running(server_id: str) -> bool:
    proc = _procs.get(server_id)
    return proc is not None and proc.poll() is None


def _tail(path: Path, lines: int = 8) -> str:
    try:
        return "\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:])
    except OSError:
        return ""


def _spawn(server_id: str, no_gpu: bool) -> tuple[subprocess.Popen[bytes], Path]:
    LOGS.mkdir(parents=True, exist_ok=True)
    log = LOGS / f"{server_id}.log"
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    with log.open("wb") as handle:
        proc = subprocess.Popen(command(server_id, no_gpu), stdout=handle, stderr=subprocess.STDOUT, creationflags=flags)
    return proc, log


def _launch(server_id: str) -> None:
    spec = config.servers()[server_id]
    for no_gpu in (False, True) if spec["kind"] == "whisper" else (False,):
        proc, log = _spawn(server_id, no_gpu)
        _procs[server_id] = proc
        print(f"  ai       starting {server_id}{' (processor)' if no_gpu else ''}...", flush=True)
        deadline = time.monotonic() + START_TIMEOUT_S[spec["kind"]]
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                break
            if _healthy(server_id):
                _last[server_id] = time.monotonic()
                print(f"  ai       {server_id} ready", flush=True)
                _ensure_reaper()
                return
            time.sleep(0.4)
        stop(server_id)
        failure = f"{server_id} did not start:\n{_tail(log)}"
    raise ServerError(failure)


def _start_lock(server_id: str) -> threading.Lock:
    with _cond:
        return _start_locks.setdefault(server_id, threading.Lock())


def _yield_group(server_id: str) -> None:
    group = config.servers()[server_id].get("group")
    if not group:
        return
    for other, spec in config.servers().items():
        if other == server_id or spec.get("group") != group or not running(other):
            continue
        with _cond:
            if not _cond.wait_for(lambda other=other: _active.get(other, 0) == 0, timeout=WAIT_FOR_IDLE_S):
                raise ServerError(f"{other} is still busy; {server_id} cannot take the GPU yet")
        print(f"  ai       stopping {other} to make room for {server_id}", flush=True)
        stop(other)


def ensure(server_id: str) -> None:
    global _atexit_set
    if server_id not in config.servers():
        raise ServerError(f"unknown server: {server_id}")
    if not _atexit_set:
        _atexit_set = True
        atexit.register(stop_all)
    if running(server_id) and _healthy(server_id):
        return
    with _start_lock(server_id):
        if running(server_id) and _healthy(server_id):
            return
        if running(server_id):
            stop(server_id)
        _yield_group(server_id)
        _launch(server_id)


@contextmanager
def use(server_id: str | None) -> Iterator[None]:
    if server_id is None:
        yield
        return
    ensure(server_id)
    with _cond:
        _active[server_id] = _active.get(server_id, 0) + 1
    try:
        yield
    finally:
        with _cond:
            _active[server_id] = max(0, _active.get(server_id, 1) - 1)
            _last[server_id] = time.monotonic()
            _cond.notify_all()


def stop(server_id: str) -> None:
    proc = _procs.pop(server_id, None)
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=8)
    except subprocess.TimeoutExpired:
        proc.kill()


def stop_all() -> None:
    for server_id in list(_procs):
        stop(server_id)


def start_background() -> threading.Thread:

    def run() -> None:
        for server_id, spec in config.servers().items():
            if spec.get("lazy") or not _wanted(server_id):
                continue
            try:
                ensure(server_id)
            except ServerError as error:
                print(f"  ai       {error}", flush=True)

    thread = threading.Thread(target=run, daemon=True, name="ai-servers")
    thread.start()
    return thread


def _wanted(server_id: str) -> bool:
    return any(config.stage(name).server == server_id for name in config.KIND)


def _ensure_reaper() -> None:
    global _reaper
    if _reaper is not None and _reaper.is_alive():
        return

    def run() -> None:
        while True:
            time.sleep(15)
            for server_id, spec in config.servers().items():
                idle = spec.get("idle_s")
                if not idle or not running(server_id):
                    continue
                with _cond:
                    quiet = _active.get(server_id, 0) == 0 and time.monotonic() - _last.get(server_id, 0.0) > idle
                if quiet:
                    print(f"  ai       stopping {server_id}: not used for {idle} s", flush=True)
                    stop(server_id)

    _reaper = threading.Thread(target=run, daemon=True, name="ai-reaper")
    _reaper.start()


def status() -> dict[str, Any]:
    return {server_id: {"running": running(server_id), "port": spec["port"]} for server_id, spec in config.servers().items()}
