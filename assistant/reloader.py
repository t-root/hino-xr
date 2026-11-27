"""Edits take effect while the server runs: no restart after a change to the Python side.

The page side already rebuilds itself (`frontend.watch_frontend`) and the page reloads on its own (`/__build`, see
`frontend.py`). This is the other half: when a `.py` file of `assistant/` or the stages file changes, the modules
of the project are imported again and the server continues with the new code, on the same port.

How it stays safe:

- A file that does not compile (an edit caught half way) is reported and waited out; the server keeps running.
- The new code is imported *before* the old server stops. If importing fails, the old modules are put back and the old
  server keeps answering.
- Modules that hold something running are not re-imported: `ai.servers` (the llama and whisper processes), `ai.config`
  (stages, the voice the wearer chose), `frontend` (the build watcher), `profiles`. An edit to one of them is reported
  as needing a restart. `models.speech` holds the loaded voice: editing it loads the voice again.

`VR_RELOAD=off` turns all of this off.
"""

from __future__ import annotations

import importlib
import os
import sys
import threading
from pathlib import Path

import profiles

ASSISTANT = Path(__file__).resolve().parent
SKIP_DIRS = {".tools", ".certs", ".venv", "bin", "data", "__pycache__", "voices"}
KEEP = {"ai.servers", "ai.config", "frontend", "profiles"}
SPEECH = "models.speech"
ENTRY = {"main", "__main__", "reloader"}


def enabled() -> bool:
    return os.environ.get("VR_RELOAD", "on").strip().lower() not in {"off", "0", "false", "no"}


def _say(message: str) -> None:
    print(message, flush=True)


def watched() -> list[Path]:
    found = []
    for path in ASSISTANT.rglob("*.py"):
        if not SKIP_DIRS.intersection(path.relative_to(ASSISTANT).parts):
            found.append(path)
    found.append(profiles.stages_file())
    return found


def stamp() -> dict[Path, float]:
    times: dict[Path, float] = {}
    for path in watched():
        try:
            times[path] = path.stat().st_mtime
        except OSError:
            continue
    return times


def module_of(path: Path) -> str | None:
    if path.suffix != ".py":
        return None
    parts = list(path.relative_to(ASSISTANT).with_suffix("").parts)
    if parts[-1] == "__init__":
        parts.pop()
    return ".".join(parts) or None


def _project_modules() -> dict[str, object]:
    found = {}
    for name, module in list(sys.modules.items()):
        file = getattr(module, "__file__", None)
        if not file or name in ENTRY:
            continue
        try:
            Path(file).resolve().relative_to(ASSISTANT)
        except ValueError:
            continue
        found[name] = module
    return found


def _compile_errors(paths: list[Path]) -> list[str]:
    problems = []
    for path in paths:
        if path.suffix != ".py":
            continue
        try:
            compile(path.read_text(encoding="utf-8"), str(path), "exec")
        except (SyntaxError, ValueError) as error:
            problems.append(f"{path.name}: {error}")
        except OSError:
            continue
    return problems


class Reloader:
    def __init__(self) -> None:
        self.seen = stamp()

    def poll(self) -> list[Path]:
        now = stamp()
        changed = [path for path, time in now.items() if self.seen.get(path) != time]
        changed += [path for path in self.seen if path not in now]
        self.seen = now
        return changed

    def reload(self, changed: list[Path]):
        problems = _compile_errors(changed)
        if problems:
            _say("  reload   not loaded, fix and save again: " + "; ".join(problems))
            return None
        changed_names = {name for name in map(module_of, changed) if name}
        stale = sorted(changed_names & KEEP)
        if profiles.stages_file() in changed:
            stale.append("ai/" + profiles.stages_file().name)
        if stale:
            _say("  reload   needs a restart to take effect: " + ", ".join(stale))
        keep = KEEP - ({SPEECH} if SPEECH in changed_names else set())
        before = _project_modules()
        old = {name: sys.modules[name] for name in before if name not in keep}
        for name in old:
            del sys.modules[name]
        try:
            app = importlib.import_module("app").app
        except Exception as error:  # noqa: BLE001 — anything: the running server must survive it
            for name in _project_modules():
                if name not in keep:
                    sys.modules.pop(name, None)
            sys.modules.update(old)
            _say(f"  reload   the new code does not load, the old one keeps running: {type(error).__name__}: {error}")
            return None
        if SPEECH in changed_names:
            from models.speech import speech

            threading.Thread(target=speech.warm, daemon=True).start()
        _say("  reload   " + ", ".join(sorted(changed_names)) + " loaded")
        return app
