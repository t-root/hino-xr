"""The assistant writing a plugin of its own, and the gate it has to pass.

A spoken request ("tạo plugin đếm số người") becomes a draft in `plugins-pending/`:
a folder shaped like any other plugin, checked and compiled but not installed.
Nothing the model wrote runs until the wearer approves it, and then only as a
camera-frame detector: `network`, `screen` and `snapshot` are granted by hand in
`permissions.ts`, so a draft can never hold them.

The checks here are a net for honest mistakes, not a sandbox. Generated code is
still code: that is why a human approves it, and why the draft folder is plain
files that can be read first.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src"
MODULES = SRC / "modules"
REGISTRY = MODULES / "registry.ts"
PENDING = ROOT / "plugins-pending"

PREFIX = "ai-"
MAX_CODE = 9000
ATTEMPTS = 3
API_URL = "https://api.anthropic.com/v1/messages"
API_VERSION = "2023-06-01"
DEFAULT_API_MODEL = "claude-sonnet-5-5"

ALLOWED_IMPORTS = {
    "@/shared/contracts/vision",
    "@/core/modules/module-contract",
    "./manifest",
    "./text.json",
}
# Everything a detector has no business touching: network, storage, page, timers, escapes.
FORBIDDEN = re.compile(
    r"\b(fetch|XMLHttpRequest|WebSocket|EventSource|eval|Function|importScripts|Worker|SharedWorker|"
    r"ServiceWorker|localStorage|sessionStorage|indexedDB|document|window|globalThis|self|navigator|"
    r"location|postMessage|require|setInterval|setTimeout|requestAnimationFrame|Reflect|Proxy|"
    r"prototype|__proto__|WebAssembly|Blob|FileReader|OffscreenCanvas)\b|\.constructor\b|\bprocess\s*\.|import\.meta|import\s*\(|<script",
)
ID_OK = re.compile(r"^[a-z][a-z0-9-]{2,40}$")

_lock = threading.Lock()
_source = "local"


class DraftError(Exception):
    """Something that stopped the draft; its text is for logs, the wearer hears a fixed line."""


def api_key() -> str | None:
    for name in ("VR_ANTHROPIC_KEY", "ANTHROPIC_API_KEY"):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return None


def source() -> str:
    return _source


def set_source(value: str) -> bool:
    """Chooses who writes the code. "api" needs a key in .env, else stays as it was."""
    global _source
    if value not in {"local", "api"}:
        return False
    if value == "api" and not api_key():
        return False
    _source = value
    return True


def default_source() -> None:
    """Every start is local and offline unless VR_CODE_SOURCE=api and a key is present."""
    set_source(os.environ.get("VR_CODE_SOURCE", "local").strip().lower())


# --- drafts on disk ----------------------------------------------------------------


def pending() -> list[dict[str, str]]:
    if not PENDING.is_dir():
        return []
    found = []
    for folder in sorted(PENDING.iterdir()):
        text_path = folder / "text.json"
        if folder.is_dir() and text_path.is_file():
            try:
                name = json.loads(text_path.read_text(encoding="utf-8"))["displayName"]
                found.append({"id": folder.name, "vi": str(name["vi"]), "en": str(name["en"])})
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


def _camel(identifier: str) -> str:
    head, *rest = identifier.split("-")
    return head + "".join(part.capitalize() for part in rest)


# --- asking a model ----------------------------------------------------------------

_SYSTEM = """You write one small plugin for an AR headset, in TypeScript. Reply in exactly this format and nothing else:

META: {"id":"short-english-slug","displayName":{"vi":"...","en":"..."},"description":{"vi":"...","en":"..."},"label":{"vi":"...","en":"..."}}
```ts
<the whole file Module.ts>
```

The plugin is a detector. Each camera frame arrives in process(); return boxes in 0..1 coordinates
(x, y, width, height). It can only look at `frame` (width, height, id, timestampMs, rotationDeg, mirrored)
and compute. It has no network, no page, no storage, no timers: do not use fetch, document, window,
setTimeout, eval or anything outside plain TypeScript and Math. Imports allowed are exactly the ones in the example.
Export `createModule` exactly as the example does. Keep the file under 120 lines. Write nothing but the format above."""

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


def _local_complete(system: str, user: str) -> str:
    from .catalog import catalog
    from .engine import engine

    spec = catalog()[0]
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    return "".join(engine.generate(spec, messages, 1800, "en", ceiling=2048))


def _api_complete(system: str, user: str) -> str:
    key = api_key()
    if not key:
        raise DraftError("api key missing")
    body = json.dumps(
        {
            "model": os.environ.get("VR_CODE_MODEL", DEFAULT_API_MODEL),
            "max_tokens": 2500,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }
    ).encode("utf-8")
    request = urllib.request.Request(
        API_URL,
        data=body,
        headers={"x-api-key": key, "anthropic-version": API_VERSION, "content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            payload = json.loads(response.read())
    except (urllib.error.URLError, TimeoutError, ValueError) as error:
        raise DraftError(f"api failed: {error}") from error
    return "".join(block.get("text", "") for block in payload.get("content", []) if block.get("type") == "text")


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
    return meta, code_match.group(1)


def check_code(code: str) -> None:
    """Raises ValueError saying what is wrong, in words a model can act on."""
    if len(code) > MAX_CODE:
        raise ValueError(f"file is too long ({len(code)} chars, limit {MAX_CODE})")
    bare = re.sub(r"//[^\n]*|/\*.*?\*/", "", code, flags=re.S)
    banned = FORBIDDEN.search(bare)
    if banned:
        raise ValueError(f"`{banned.group(0)}` is not allowed in a plugin")
    for target in re.findall(r'from\s+"([^"]+)"', bare):
        if target not in ALLOWED_IMPORTS:
            raise ValueError(f'import "{target}" is not allowed; only {sorted(ALLOWED_IMPORTS)}')
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
        '  permissions: ["camera-frame"],\n'
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
    """Bundles the draft's entry once, discarding the output: catches syntax mistakes."""
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


def draft(description: str, locale: str, kind: str | None = None) -> dict[str, str]:
    """Has a model write the plugin, checks it, and leaves it in `plugins-pending/`."""
    use = kind or _source
    ask = _api_complete if use == "api" else _local_complete
    request = f"Write a plugin that does this: {description.strip()[:400]}"
    last = ""
    with _lock:
        for _ in range(ATTEMPTS):
            prompt = f"{request}\n\nExample of the file shape:\n```ts\n{_EXAMPLE}```"
            if last:
                prompt += f"\n\nYour previous attempt was rejected: {last}\nFix exactly that and answer again in the format."
            reply = ask(_SYSTEM, prompt)
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
            return {"id": plugin_id, "name": name, "source": use}
    raise DraftError(f"could not produce a valid plugin: {last}")


# --- approving, rejecting ----------------------------------------------------------


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


def _register(plugin_id: str, source_text: str) -> str:
    var = _camel(plugin_id)
    imports = list(re.finditer(r"^import .*;$", source_text, re.M))
    if not imports or f"./{plugin_id}/plugin" in source_text:
        raise ValueError("registry.ts is not in the expected shape")
    end = imports[-1].end()
    with_import = source_text[:end] + f'\nimport {var} from "./{plugin_id}/plugin";' + source_text[end:]
    pattern = re.compile(r"(const entries: ReadonlyArray<PluginEntry> = \[)([^\]]*)(\];)")
    found = pattern.search(with_import)
    if not found:
        raise ValueError("registry.ts has no entries array")
    items = found.group(2).strip().rstrip(",")
    return with_import[: found.start()] + f"{found.group(1)}{items}, {var}{found.group(3)}" + with_import[found.end():]


def approve(plugin_id: str) -> None:
    """Installs a draft into `src/modules/`, lists it in the registry and rebuilds the app."""
    folder = _pending_folder(plugin_id)
    if folder is None:
        raise DraftError("no such draft")
    try:
        check_code((folder / "Module.ts").read_text(encoding="utf-8"))
    except (ValueError, OSError) as error:
        raise DraftError(f"draft no longer passes the checks: {error}") from error
    target = MODULES / plugin_id
    if target.exists():
        raise DraftError("a plugin with that id already exists")
    original = REGISTRY.read_text(encoding="utf-8")
    try:
        updated = _register(plugin_id, original)
    except ValueError as error:
        raise DraftError(str(error)) from error
    shutil.move(str(folder), str(target))
    REGISTRY.write_text(updated, encoding="utf-8")
    try:
        import frontend

        frontend.bundle(_esbuild())
    except Exception as error:  # noqa: BLE001 — put everything back whatever broke
        REGISTRY.write_text(original, encoding="utf-8")
        shutil.move(str(target), str(folder))
        raise DraftError(f"build failed: {error}") from error
