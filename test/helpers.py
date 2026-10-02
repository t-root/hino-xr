"""Shared paths for the Python tests."""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
ASSISTANT = ROOT / "assistant"


# What Python downloads into a plugin's folder: packages and model files.
DOWNLOADED = {"vendor", "models"}


def downloaded_into_plugin(path: Path) -> bool:
    """True for files under src/modules/<id>/vendor or src/modules/<id>/models only."""
    parts = path.resolve().relative_to(SRC.resolve()).parts if path.resolve().is_relative_to(SRC.resolve()) else ()
    return len(parts) > 3 and parts[0] == "modules" and parts[2] in DOWNLOADED


def walk(directory: Path, suffixes: tuple[str, ...] = (".ts", ".tsx")) -> list[Path]:
    files: list[Path] = []
    for path in directory.rglob("*"):
        if downloaded_into_plugin(path):
            continue
        if path.is_file() and path.suffix in suffixes:
            files.append(path)
    return files


def rel(path: Path, start: Path = SRC) -> str:
    return path.relative_to(start).as_posix()
