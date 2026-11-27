
from __future__ import annotations

import json
import re
import shutil
import subprocess
import threading
import unicodedata
from pathlib import Path
from typing import Any

import ai

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src"
MODULES = SRC / "modules"
PENDING = ROOT / "plugins-pending"
BACKUP = ROOT / "plugins-backup"
EDIT_SUFFIX = "--edit"

PREFIX = "ai-"
MAX_CODE = 9000
ATTEMPTS = 3

PERMISSIONS = ("camera-frame", "network", "screen", "snapshot")
FORBIDDEN = re.compile(
    r"\b(eval|Function|ServiceWorker|SharedWorker|Reflect|Proxy|prototype|__proto__|require)\b"
    r"|\.constructor\b|\bprocess\s*\.|import\.meta|import\s*\(|<script",
)
IMPORT_OK = re.compile(r"^(@/[\w./-]+|\./[\w.-]+)$")
ID_OK = re.compile(r"^[a-z][a-z0-9-]{2,60}$")

_lock = threading.Lock()


class DraftError(Exception):
    pass


def pending() -> list[dict[str, str]]:
    if not PENDING.is_dir():
        return []
    found = []
    for folder in sorted(PENDING.iterdir()):
        text_path = folder / "text.json"
        if folder.is_dir() and text_path.is_file():
            try:
                name = json.loads(text_path.read_text(encoding="utf-8"))["displayName"]
                suffix = {"vi": " (bản sửa)", "en": " (edit)"} if folder.name.endswith(EDIT_SUFFIX) else {"vi": "", "en": ""}
                found.append({"id": folder.name, "vi": str(name["vi"]) + suffix["vi"], "en": str(name["en"]) + suffix["en"]})
            except (KeyError, ValueError, TypeError):
                continue
    return found


def _slug(raw: str) -> str:
    plain = unicodedata.normalize("NFD", raw.replace("đ", "d").replace("Đ", "D").lower())
    plain = "".join(char for char in plain if unicodedata.category(char) != "Mn")
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", plain)).strip("-")


def _unique_id(raw: str) -> str:
    base = _slug(raw)
    if not base.startswith(PREFIX):
        base = PREFIX + base
    base = base[:40].rstrip("-")
    taken = {path.name for path in MODULES.iterdir() if path.is_dir()} | {item["id"] for item in pending()}
    candidate, number = base, 2
    while candidate in taken:
        candidate = f"{base[:36]}-{number}"
        number += 1
    return candidate


_SYSTEM = """You write one small plugin for an AR headset, in TypeScript. Reply in exactly this format and nothing else:

META: {"id":"short-english-slug","displayName":{"vi":"...","en":"..."},"description":{"vi":"...","en":"..."},"label":{"vi":"...","en":"..."},"permissions":["camera-frame"]}
```ts
<the whole file Module.ts>
```

The plugin is a detector. Each camera frame arrives in process(); return boxes in 0..1 coordinates
(x, y, width, height). It looks at `frame` (width, height, id, timestampMs, rotationDeg, mirrored) and computes.
META.permissions lists what it needs, from "camera-frame" (always), "network" (fetch to other servers),
"screen" (its own interface: `context.screen?.show((element) => { ... })` draws into a div) and "snapshot".
Ask only for what the plugin uses. eval, Function and dynamic import() are not allowed. Import only from "@/..." or "./...".
Export `createModule` exactly as the example does. Keep the file under 200 lines. Write nothing but the format above."""

_EXAMPLE = """import type { DetectionBatch, FramePacket } from "@/shared/contracts/vision";
import type { ModuleContext, VisionModule } from "@/core/modules/module-contract";
import { manifest } from "./manifest";
import text from "./text.json";

class Module implements VisionModule {
  readonly manifest = manifest;
  private enabled = false;
  private startedAtMs = 0;
  private context: ModuleContext | null = null;

  async initialize(context: ModuleContext): Promise<void> {
    this.startedAtMs = performance.now();
    this.context = context;
  }

  async process(frame: FramePacket): Promise<DetectionBatch> {
    const elapsed = (performance.now() - this.startedAtMs) / 1000;
    const width = 0.22;
    const height = 0.3;
    const x = 0.5 + Math.cos(elapsed * 0.9) * 0.25 - width / 2;
    const y = 0.5 + Math.sin(elapsed * 1.3) * 0.18 - height / 2;
    return {
      moduleId: this.manifest.id,
      sourceFrameId: frame.id,
      producedAtMs: performance.now(),
      detections: this.enabled
        ? [
            {
              id: "target",
              kind: "object",
              bounds: { x, y, width, height },
              confidence: 0.9,
              label: text.label[this.context?.locale() ?? "vi"],
              interaction: { selectable: true, detailAction: "inspect" },
            },
          ]
        : [],
    };
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
  }

  async dispose(): Promise<void> {
    this.enabled = false;
  }
}

export const createModule = (): VisionModule => new Module();
"""


def _complete(system: str, user: str) -> str:
    """The `code` stage writes: a model of this machine started for the occasion, or an endpoint set in `.env`."""
    try:
        return ai.text("code", system, user, 2500)
    except ai.AIError as error:
        raise DraftError(f"the code model failed: {error}") from error


def _parse(reply: str) -> tuple[dict[str, Any], str]:
    meta_match = re.search(r"META:\s*(\{.*\})", reply)
    code_match = re.search(r"```(?:ts|typescript)?\s*\n(.*?)```", reply, re.S)
    if not meta_match or not code_match:
        raise ValueError("reply must contain a META: line and one ```ts code block")
    try:
        meta = json.loads(meta_match.group(1))
    except ValueError as error:
        raise ValueError(f"META is not valid JSON: {error}") from error
    for key in ("displayName", "description", "label"):
        value = meta.get(key)
        if not isinstance(value, dict) or not all(
            isinstance(value.get(lang), str) and value[lang].strip() for lang in ("vi", "en")
        ):
            raise ValueError(f"META.{key} needs non-empty vi and en")
    if not isinstance(meta.get("id"), str) or not _slug(meta["id"]):
        raise ValueError("META.id must be a short english slug")
    asked = meta.get("permissions", ["camera-frame"])
    if not isinstance(asked, list) or not all(item in PERMISSIONS for item in asked):
        raise ValueError(f"META.permissions must be a list taken from {list(PERMISSIONS)}")
    meta["permissions"] = ["camera-frame", *[item for item in PERMISSIONS[1:] if item in asked]]
    return meta, code_match.group(1)


def check_code(code: str) -> None:
    if len(code) > MAX_CODE:
        raise ValueError(f"file is too long ({len(code)} chars, limit {MAX_CODE})")
    bare = re.sub(r"//[^\n]*|/\*.*?\*/", "", code, flags=re.S)
    banned = FORBIDDEN.search(bare)
    if banned:
        raise ValueError(f"`{banned.group(0)}` is not allowed in a plugin")
    for target in re.findall(r'from\s+"([^"]+)"', bare):
        if not IMPORT_OK.match(target):
            raise ValueError(f'import "{target}" is not allowed; import only from "@/..." or "./..."')
    if not re.search(r"export\s+const\s+createModule\b", bare):
        raise ValueError("the file must `export const createModule = (): VisionModule => ...`")
    if "process(" not in bare:
        raise ValueError("the module must implement process(frame)")


def _write(folder: Path, plugin_id: str, meta: dict[str, Any], code: str) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    text = {
        key: {"vi": meta[key]["vi"].strip(), "en": meta[key]["en"].strip()}
        for key in ("displayName", "description", "label")
    }
    (folder / "text.json").write_text(json.dumps(text, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (folder / "manifest.ts").write_text(
        'import type { ModuleManifest } from "@/shared/contracts/vision";\n'
        'import text from "./text.json";\n\n'
        "export const manifest: ModuleManifest = {\n"
        f'  id: "{plugin_id}",\n'
        '  version: "0.1.0",\n'
        "  displayName: text.displayName,\n"
        "  description: text.description,\n"
        "  input: { preferredFps: 8 },\n"
        '  outputKinds: ["object"],\n'
        '  execution: "main",\n'
        f"  permissions: {json.dumps(meta.get('permissions', ['camera-frame']))},\n"
        "};\n",
        encoding="utf-8",
    )
    (folder / "plugin.ts").write_text(
        'import { definePlugin } from "@/core/modules/definePlugin";\n'
        'import { manifest } from "./manifest";\n\n'
        "export default definePlugin({\n"
        "  manifest,\n"
        "  load: async () => {\n"
        '    const { createModule } = await import("./Module");\n'
        "    return createModule();\n"
        "  },\n"
        "});\n",
        encoding="utf-8",
    )
    (folder / "Module.ts").write_text(code.strip() + "\n", encoding="utf-8")


def _esbuild() -> Path:
    import frontend

    return frontend.ensure_esbuild(frontend._package_specs()["esbuild"])


def compile_check(folder: Path) -> None:
    import frontend

    out = folder / ".check.js"
    result = subprocess.run(
        frontend._esbuild_args(_esbuild(), folder / "plugin.ts", f"--outfile={out}", "--format=esm"),
        cwd=ROOT,
        env=frontend._esbuild_env(),
        capture_output=True,
        text=True,
    )
    out.unlink(missing_ok=True)
    if result.returncode != 0:
        raise ValueError(result.stderr.strip()[-600:] or "build failed")


def draft(description: str, locale: str) -> dict[str, str]:
    request = f"Write a plugin that does this: {description.strip()[:400]}"
    last = ""
    for _ in range(ATTEMPTS):
        prompt = f"{request}\n\nExample of the file shape:\n```ts\n{_EXAMPLE}```"
        if last:
            prompt += f"\n\nYour previous attempt was rejected: {last}\nFix exactly that and answer again in the format."
        reply = _complete(with_rules(_SYSTEM), prompt)
        with _lock:
            folder: Path | None = None
            try:
                meta, code = _parse(reply)
                check_code(code)
                plugin_id = _unique_id(str(meta["id"]))
                folder = PENDING / plugin_id
                _write(folder, plugin_id, meta, code)
                compile_check(folder)
            except ValueError as error:
                if folder is not None:
                    shutil.rmtree(folder, ignore_errors=True)
                last = str(error)
                continue
        name = meta["displayName"]["vi" if locale == "vi" else "en"]
        return {"id": plugin_id, "name": name}
    raise DraftError(f"could not produce a valid plugin: {last}")


def _pending_folder(plugin_id: str) -> Path | None:
    if not ID_OK.match(plugin_id):
        return None
    folder = PENDING / plugin_id
    return folder if folder.is_dir() else None


def reject(plugin_id: str) -> bool:
    folder = _pending_folder(plugin_id)
    if folder is None:
        return False
    shutil.rmtree(folder)
    return True


def approve(plugin_id: str) -> None:
    with _lock:
        _approve(plugin_id)


def _approve(plugin_id: str) -> None:
    folder = _pending_folder(plugin_id)
    if folder is None:
        raise DraftError("no such draft")
    if (folder / "edit.json").is_file():
        _apply_edit(folder)
        return
    try:
        check_code((folder / "Module.ts").read_text(encoding="utf-8"))
    except (ValueError, OSError) as error:
        raise DraftError(f"draft no longer passes the checks: {error}") from error
    target = MODULES / plugin_id
    if target.exists():
        raise DraftError("a plugin with that id already exists")
    shutil.move(str(folder), str(target))
    import frontend

    try:
        frontend.bundle(_esbuild())
    except Exception as error:  # noqa: BLE001 — put everything back whatever broke
        shutil.move(str(target), str(folder))
        (frontend.LIVE / f"{plugin_id}.js").unlink(missing_ok=True)
        raise DraftError(f"build failed: {error}") from error


EDITABLE = {".ts", ".json", ".css"}
LOCKED = {"models.json", "vendor.json"}
MAX_SOURCE = 28000

RULES = MODULES / "PLUGIN_RULES.md"


def rules() -> str:
    try:
        return RULES.read_text(encoding="utf-8").strip()
    except OSError as error:
        raise DraftError(f"the plugin rules are missing ({RULES.name}): nothing is written without them") from error


def with_rules(system: str) -> str:
    return f"{system}\n\nThe rules of this project for every plugin. The plugin must follow them:\n\n{rules()}"


_REVISE_SYSTEM = """You fix or change one plugin of an AR headset, written in TypeScript. You are given all its files and a request.
Reply with every file you change, each whole, in this format and nothing else:

FILE: Name.ts
```ts
<the whole new file>
```

Change only what the request needs. Keep every export and import that other files rely on. Do not add files and do not
touch models.json. Keep user-visible words in text.json, in both vi and en."""


def _plugin_files(folder: Path) -> dict[str, str]:
    files: dict[str, str] = {}
    for path in sorted(folder.iterdir()):
        if path.is_file() and path.suffix in EDITABLE and path.name not in LOCKED:
            files[path.name] = path.read_text(encoding="utf-8")
    if sum(len(text) for text in files.values()) > MAX_SOURCE:
        raise DraftError("plugin too large to change in one go")
    return files


def _parse_files(reply: str, known: set[str]) -> dict[str, str]:
    found = {name: body for name, body in re.findall(r"FILE:\s*([\w.\-]+)\s*\n```[\w]*\s*\n(.*?)```", reply, re.S)}
    if not found:
        raise ValueError("reply must hold one or more `FILE: Name.ext` blocks, each with the whole file in a code block")
    for name, body in found.items():
        if name not in known:
            raise ValueError(f"{name} is not a file of this plugin; the files are {sorted(known)}")
        if name.endswith(".json"):
            try:
                json.loads(body)
            except ValueError as error:
                raise ValueError(f"{name} is not valid JSON: {error}") from error
    return found


def revise(plugin_id: str, request: str, locale: str) -> dict[str, str]:
    target = MODULES / plugin_id
    if not ID_OK.match(plugin_id) or not (target / "plugin.ts").is_file():
        raise DraftError("no such plugin")
    files = _plugin_files(target)
    listing = "\n\n".join(f"FILE: {name}\n```\n{text}```" for name, text in files.items())
    last = ""
    for _ in range(ATTEMPTS):
        prompt = f"Request: {request.strip()[:600]}\n\nThe plugin's files:\n\n{listing}"
        if last:
            prompt += f"\n\nYour previous attempt was rejected: {last}\nFix exactly that and answer again in the format."
        reply = _complete(with_rules(_REVISE_SYSTEM), prompt)
        with _lock:
            check = PENDING / f"_check-{plugin_id}"
            try:
                changed = _parse_files(reply, set(files))
                if plugin_id.startswith(PREFIX) and "Module.ts" in changed:
                    check_code(changed["Module.ts"])
                shutil.rmtree(check, ignore_errors=True)
                shutil.copytree(target, check, ignore=shutil.ignore_patterns("models"))
                for name, body in changed.items():
                    (check / name).write_text(body.strip() + "\n", encoding="utf-8")
                compile_check(check)
            except ValueError as error:
                last = str(error)
                continue
            finally:
                shutil.rmtree(check, ignore_errors=True)
            folder = PENDING / f"{plugin_id}{EDIT_SUFFIX}"
            shutil.rmtree(folder, ignore_errors=True)
            folder.mkdir(parents=True)
            for name, body in changed.items():
                (folder / name).write_text(body.strip() + "\n", encoding="utf-8")
            (folder / "edit.json").write_text(
                json.dumps({"target": plugin_id, "files": sorted(changed), "request": request.strip()[:600]}, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            shutil.copyfile(target / "text.json", folder / "text.json") if "text.json" not in changed else None
            names = json.loads((target / "text.json").read_text(encoding="utf-8"))["displayName"]
        return {"id": folder.name, "name": names["vi" if locale == "vi" else "en"] + (" (bản sửa)" if locale == "vi" else " (edit)")}
    raise DraftError(f"could not produce a valid change: {last}")


def _apply_edit(folder: Path) -> None:
    import time

    try:
        info = json.loads((folder / "edit.json").read_text(encoding="utf-8"))
        target = MODULES / str(info["target"])
        names = [str(name) for name in info["files"]]
    except (OSError, ValueError, KeyError) as error:
        raise DraftError(f"edit is unreadable: {error}") from error
    if not (target / "plugin.ts").is_file() or any("/" in name or "\\" in name for name in names):
        raise DraftError("edit does not fit a plugin that exists")
    if info["target"].startswith(PREFIX) and "Module.ts" in names:
        try:
            check_code((folder / "Module.ts").read_text(encoding="utf-8"))
        except ValueError as error:
            raise DraftError(f"change no longer passes the checks: {error}") from error
    saved = BACKUP / f"{target.name}-{time.strftime('%Y%m%d-%H%M%S')}"
    saved.mkdir(parents=True)
    before = {name: (target / name).read_bytes() for name in names if (target / name).is_file()}
    for name, data in before.items():
        (saved / name).write_bytes(data)
    try:
        for name in names:
            (target / name).write_text((folder / name).read_text(encoding="utf-8"), encoding="utf-8")
        compile_check(target)
        import frontend

        frontend.bundle(_esbuild())
    except Exception as error:  # noqa: BLE001 — put everything back whatever broke
        for name in names:
            if name in before:
                (target / name).write_bytes(before[name])
            else:
                (target / name).unlink(missing_ok=True)
        raise DraftError(f"build failed: {error}") from error
    shutil.rmtree(folder, ignore_errors=True)
