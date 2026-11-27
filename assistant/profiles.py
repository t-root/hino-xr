"""The profile this machine runs: `VR_PROFILE=cpu` (the default) or `VR_PROFILE=gpu`.

- cpu: a computer without an NVIDIA card (a laptop). Small models on the processor; the server speaks HTTPS with a
  self-signed certificate on the local network, and a phone on the same Wi-Fi opens the address printed at start-up.
- gpu: a rented server with a GPU. Big models on the card (Windows, CUDA builds); the server speaks plain HTTP on
  127.0.0.1 only, and `run.py` opens a Cloudflare tunnel that is the way in (see `tunnel()`).

Only what differs lives in the profile: `ai/stages.<profile>.json`, the `profile` of each entry of `downloads.json`,
and the few functions below. Standard library only: `run.py` reads it before anything is installed.
"""

from __future__ import annotations

import os
from pathlib import Path

CPU = "cpu"
GPU = "gpu"
PROFILES = (CPU, GPU)

ASSISTANT = Path(__file__).resolve().parent


def load_env() -> None:
    """Read VR_* from assistant/.env or the repo .env. Ignore leftover VITE_ keys. A variable already set wins."""
    for path in (ASSISTANT / ".env", ASSISTANT.parent / ".env"):
        if not path.is_file():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, _, value = stripped.partition("=")
            key = key.strip()
            if not key or key.startswith("VITE_"):
                continue
            os.environ.setdefault(key, value.strip().strip('"').strip("'"))


def name() -> str:
    """The profile chosen by `VR_PROFILE`; cpu when it is not set. An unknown name is an error, not a silent default."""
    raw = os.environ.get("VR_PROFILE", "").strip().lower() or CPU
    if raw not in PROFILES:
        raise ValueError("VR_PROFILE=%s: it is %s" % (raw, " or ".join(PROFILES)))
    return raw


def is_gpu() -> bool:
    return name() == GPU


def stages_file() -> Path:
    return ASSISTANT / "ai" / ("stages.%s.json" % name())


def wanted(entry: dict) -> bool:
    return name() in entry.get("profile", PROFILES)


def tunnel() -> bool:
    """A public Cloudflare address in front of the server: the gpu profile, unless `VR_TUNNEL=off`. The cpu profile has
    none: a phone on the same Wi-Fi opens the computer's address, and nothing is reachable from outside."""
    off = os.environ.get("VR_TUNNEL", "on").strip().lower() in {"off", "0", "false", "no"}
    return is_gpu() and not off


def host() -> str:
    return "127.0.0.1" if is_gpu() else "0.0.0.0"


def https() -> bool:
    return not is_gpu()
