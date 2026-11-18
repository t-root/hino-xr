"""How long each part of a spoken turn took, so "it is slow" can be told apart: the model or the machine.

One turn is: the microphone line is turned into text (listen), the model starts writing (first word) and
goes on at some speed (tokens a second), and each sentence is turned into speech (speak). `begin()` opens a
turn, the engine notes what it measured, `finish()` prints one line to the log and keeps it as `last` for the
setup card (`modelswitch.status`). Only the latest turn is kept; there is one wearer.
"""

from __future__ import annotations

import threading
import time
from contextlib import contextmanager
from typing import Any, Iterator

_lock = threading.Lock()
_turn: dict[str, Any] | None = None
last: dict[str, Any] = {}


def begin() -> None:
    global _turn
    with _lock:
        _turn = {"t0": time.monotonic(), "listen": None, "first": None, "tokens": 0, "write": None, "speak": [], "where": ""}


def note(key: str, value: Any) -> None:
    with _lock:
        if _turn is not None:
            _turn[key] = value


@contextmanager
def measure(key: str) -> Iterator[None]:
    """Time a block into `key` (listen); each use of "speak" adds one sentence."""
    start = time.monotonic()
    try:
        yield
    finally:
        took = time.monotonic() - start
        with _lock:
            if _turn is not None:
                if key == "speak":
                    _turn["speak"].append(took)
                else:
                    _turn[key] = took


def tokens(count: int, first: float | None, write: float | None) -> None:
    with _lock:
        if _turn is not None:
            _turn["tokens"], _turn["first"], _turn["write"] = count, first, write


def finish() -> None:
    """Close the turn: one line in the log, and the numbers kept for the setup card."""
    global _turn, last
    with _lock:
        turn, _turn = _turn, None
    if turn is None:
        return
    turn["total"] = time.monotonic() - turn["t0"]
    last = turn
    print(f"  time     {line(turn)}", flush=True)


def _rate(turn: dict[str, Any]) -> float | None:
    if turn["tokens"] > 1 and turn["write"]:
        return turn["tokens"] / turn["write"]
    return None


def line(turn: dict[str, Any]) -> str:
    """The turn in English, for the log: a console line, not something to read aloud."""
    parts = []
    if turn["listen"] is not None:
        parts.append(f"listen {turn['listen']:.1f}s")
    if turn["first"] is not None:
        parts.append(f"first word {turn['first']:.1f}s")
    rate = _rate(turn)
    if rate:
        parts.append(f"{rate:.1f} tok/s")
    if turn["speak"]:
        parts.append(f"speak {sum(turn['speak']) / len(turn['speak']):.1f}s x{len(turn['speak'])}")
    parts.append(f"total {turn['total']:.1f}s")
    return " | ".join(parts)


def summary(locale: str) -> str | None:
    """The last turn for the screen, in the wearer's language; None before any turn."""
    turn = last
    if not turn:
        return None
    vi = locale == "vi"
    parts = []
    if turn["listen"] is not None:
        parts.append(f"{'nghe' if vi else 'listen'} {turn['listen']:.1f}s")
    if turn["first"] is not None:
        parts.append(f"{'chữ đầu' if vi else 'first word'} {turn['first']:.1f}s")
    rate = _rate(turn)
    if rate:
        parts.append(f"{rate:.1f} token/{'giây' if vi else 's'}")
    if turn["speak"]:
        mean = sum(turn["speak"]) / len(turn["speak"])
        parts.append(f"{'đọc' if vi else 'speak'} {mean:.1f}s/{'câu' if vi else 'sentence'}")
    parts.append(f"{'tổng' if vi else 'total'} {turn['total']:.1f}s")
    return ("Lần trả lời gần nhất: " if vi else "Last turn: ") + " · ".join(parts)
