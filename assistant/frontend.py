"""Serve the headset page from this process: no Node.js required to run."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import socket
import subprocess
import tarfile
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from io import BytesIO
from ipaddress import ip_address
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

ASSISTANT = Path(__file__).resolve().parent
PROJECT = ASSISTANT.parent
SRC = PROJECT / "src"
PUBLIC = PROJECT / "public"
RUNTIME = PUBLIC / ".runtime"
TOOLS = ASSISTANT / ".tools"
CERTS = ASSISTANT / ".certs"
VENDOR = PROJECT / "vendor"
VENDOR_LOCK = PROJECT / "vendor.json"

PERMISSIONS_POLICY = (
    "accelerometer=(self), ambient-light-sensor=(self), attribution-reporting=(self), "
    "autoplay=(self), bluetooth=(self), camera=(self), clipboard-read=(self), "
    "clipboard-write=(self), compute-pressure=(self), display-capture=(self), "
    "encrypted-media=(self), fullscreen=(self), gamepad=(self), geolocation=(self), "
    "gyroscope=(self), hid=(self), identity-credentials-get=(self), idle-detection=(self), "
    "local-fonts=(self), magnetometer=(self), microphone=(self), midi=(self), "
    "otp-credentials=(self), payment=(self), picture-in-picture=(self), "
    "publickey-credentials-create=(self), publickey-credentials-get=(self), "
    "screen-wake-lock=(self), serial=(self), storage-access=(self), usb=(self), "
    "web-share=(self), window-management=(self), xr-spatial-tracking=(self)"
)

_UA = {"User-Agent": "vr-core-python"}


def _log(message: str) -> None:
    print(message, flush=True)


def _megabytes(size: int) -> str:
    return f"{size / 1024 / 1024:.2f} MB"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _package_specs() -> dict[str, str]:
    raw = json.loads(VENDOR_LOCK.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not raw:
        raise RuntimeError("vendor.json must name each downloaded package and its exact version")
    specs: dict[str, str] = {}
    for name, version in raw.items():
        if not isinstance(name, str) or not isinstance(version, str):
            raise RuntimeError(f"vendor.json: {name!r} must map to a version string")
        if any(mark in version for mark in "^~>=<"):
            raise RuntimeError(f"vendor.json: {name} must pin an exact version, not {version!r}")
        specs[name] = version
    return specs


def _fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers=_UA)
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def _npm_tarball(name: str, version: str) -> str:
    pkg = name.rsplit("/", 1)[-1]
    return f"https://registry.npmjs.org/{name}/-/{pkg}-{version}.tgz"


def _extract_npm(archive: bytes, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    buffer = tarfile.open(fileobj=BytesIO(archive), mode="r:gz")
    try:
        for member in buffer.getmembers():
            parts = Path(member.name).parts
            if not parts or parts[0] != "package":
                continue
            relative = Path(*parts[1:]) if len(parts) > 1 else Path()
            target = dest / relative
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            if member.issym() or member.islnk():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            extracted = buffer.extractfile(member)
            if extracted is None:
                continue
            target.write_bytes(extracted.read())
    finally:
        buffer.close()


def ensure_package(name: str, version: str, root: Path = VENDOR) -> Path:
    dest = root / name
    marker = dest / "package.json"
    if marker.exists():
        installed = json.loads(marker.read_text(encoding="utf-8")).get("version")
        if installed == version:
            return dest
        _log(f"  vendor   {name} is {installed}, vendor.json pins {version}")
    _log(f"  vendor   downloading {name}@{version}")
    try:
        archive = _fetch(_npm_tarball(name, version))
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"could not download {name}@{version}: {error}") from error
    # Unpacking over another version would leave its files behind.
    if dest.exists():
        shutil.rmtree(dest)
    _extract_npm(archive, dest)
    if not marker.exists():
        raise RuntimeError(f"package {name} extracted without package.json")
    _log(f"  vendor   {name}@{version} ({_megabytes(len(archive))} archive)")
    return dest


def _esbuild_package() -> str:
    system = platform.system()
    machine = platform.machine().lower()
    arm = machine in {"arm64", "aarch64"} or "arm" in machine
    if system == "Windows":
        return "@esbuild/win32-arm64" if arm else "@esbuild/win32-x64"
    if system == "Darwin":
        return "@esbuild/darwin-arm64" if arm else "@esbuild/darwin-x64"
    if system == "Linux":
        return "@esbuild/linux-arm64" if arm else "@esbuild/linux-x64"
    raise RuntimeError(f"unsupported platform for esbuild: {system} {machine}")


def ensure_esbuild(version: str) -> Path:
    exe_name = "esbuild.exe" if platform.system() == "Windows" else "esbuild"
    cached = TOOLS / exe_name
    if cached.exists():
        return cached
    bundled = VENDOR / _esbuild_package() / exe_name
    if bundled.exists():
        TOOLS.mkdir(parents=True, exist_ok=True)
        shutil.copy2(bundled, cached)
        if platform.system() != "Windows":
            cached.chmod(cached.stat().st_mode | 0o111)
        return cached
    name = _esbuild_package()
    dest = TOOLS / "esbuild-pkg"
    _log(f"  tool     downloading {name}@{version}")
    archive = _fetch(_npm_tarball(name, version))
    if dest.exists():
        shutil.rmtree(dest)
    _extract_npm(archive, dest)
    found = dest / exe_name
    if not found.exists():
        found = dest / "bin" / exe_name
    if not found.exists():
        raise RuntimeError(f"esbuild binary missing from {name}")
    TOOLS.mkdir(parents=True, exist_ok=True)
    shutil.copy2(found, cached)
    if platform.system() != "Windows":
        cached.chmod(cached.stat().st_mode | 0o111)
    return cached


PLUGIN_MODELS_DIR = "models"
PLUGIN_VENDOR_DIR = "vendor"


def _plugin_folders() -> list[Path]:
    modules = SRC / "modules"
    if not modules.is_dir():
        return []
    return sorted(path for path in modules.iterdir() if path.is_dir())


def _declared_files(folder: Path) -> list[dict[str, str]]:
    """The on-device files a plugin's own models.json names."""
    spec_path = folder / "models.json"
    if not spec_path.exists():
        return []
    spec = json.loads(spec_path.read_text(encoding="utf-8"))
    files: list[dict[str, str]] = []
    seen: set[str] = set()
    for model in spec.get("files") or []:
        file_name = model.get("file")
        url = model.get("url")
        digest = model.get("sha256")
        if not file_name or not url or not digest:
            raise RuntimeError(f"{folder.name}/models.json: each file needs file, url and sha256")
        if Path(file_name).name != file_name:
            raise RuntimeError(f"{folder.name}/models.json: {file_name!r} must be a bare file name")
        if file_name in seen:
            raise RuntimeError(f"{folder.name}/models.json: duplicate file {file_name!r}")
        seen.add(file_name)
        files.append({"file": file_name, "url": url, "sha256": digest})
    return files


def _plugin_models() -> list[dict[str, object]]:
    """
    Every plugin model, each kept in its own plugin's folder
    (`src/modules/<id>/models/`), never in a place shared with others.
    """
    return [
        {**model, "dest": folder / PLUGIN_MODELS_DIR}
        for folder in _plugin_folders()
        for model in _declared_files(folder)
    ]


def prepare_plugin_packages() -> None:
    """
    A library only one plugin uses is pinned in that plugin's own vendor.json
    and unpacked into its own `vendor/` folder, where it imports it by a
    relative path. Core's vendor.json lists only what Core itself runs on.
    """
    for folder in _plugin_folders():
        lock = folder / "vendor.json"
        if not lock.exists():
            continue
        specs = json.loads(lock.read_text(encoding="utf-8"))
        for name, version in specs.items():
            if not isinstance(version, str) or any(mark in version for mark in "^~>=<"):
                raise RuntimeError(f"{folder.name}/vendor.json: {name} must pin an exact version")
            ensure_package(name, version, folder / PLUGIN_VENDOR_DIR)


def prepare_models() -> None:
    """Models a plugin declares in its own models.json. Core's own are in the root downloads.json."""
    for model in _plugin_models():
        dest = model["dest"]
        assert isinstance(dest, Path)
        dest.mkdir(parents=True, exist_ok=True)
        path = dest / str(model["file"])
        if path.exists() and _sha256(path.read_bytes()) == model["sha256"]:
            _log(f"  model    {model['file']} already present ({_megabytes(path.stat().st_size)})")
            continue
        _log(f"  model    downloading {model['file']}")
        try:
            data = _fetch(model["url"])
        except (urllib.error.URLError, TimeoutError) as error:
            _log(f"  model    could not fetch {model['file']}: {error}")
            continue
        digest = _sha256(data)
        if digest != model["sha256"]:
            _log(f"  model    hash mismatch for {model['file']}")
            continue
        path.write_bytes(data)
        _log(f"  model    downloaded {model['file']} ({_megabytes(len(data))})")


def copy_mediapipe_wasm(package_dir: Path) -> None:
    wasm_src = package_dir / "wasm"
    wasm_dest = PUBLIC / "mediapipe" / "wasm"
    version = json.loads((package_dir / "package.json").read_text(encoding="utf-8"))["version"]
    marker = PUBLIC / "mediapipe" / ".version"
    if marker.exists() and marker.read_text(encoding="utf-8").strip() == version and wasm_dest.is_dir():
        _log(f"  runtime  {version} already in public/mediapipe/wasm")
        return
    if wasm_dest.exists():
        shutil.rmtree(wasm_dest)
    shutil.copytree(wasm_src, wasm_dest)
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(f"{version}\n", encoding="utf-8")
    _log(f"  runtime  copied {version} wasm")


def _worker_entries() -> list[str]:
    return sorted(path.relative_to(SRC).as_posix() for path in SRC.rglob("*.worker.ts"))


def _needs_bundle(outfile: Path) -> bool:
    if not outfile.exists():
        return True
    latest = outfile.stat().st_mtime
    if (ASSISTANT / "frontend.py").stat().st_mtime > latest:
        return True
    for path in SRC.rglob("*"):
        # A plugin's downloads (src/modules/<id>/vendor|models) are not source;
        # Core's own folders may share those names (src/core/models).
        relative = path.relative_to(SRC).parts
        if len(relative) > 3 and relative[0] == "modules" and relative[2] in {PLUGIN_VENDOR_DIR, PLUGIN_MODELS_DIR}:
            continue
        if path.suffix in {".ts", ".json", ".css"} and path.stat().st_mtime > latest:
            return True
    return False


def _package_aliases() -> list[str]:
    return [
        f"--alias:three={(VENDOR / 'three').as_posix()}",
        f"--alias:zod={(VENDOR / 'zod').as_posix()}",
        f"--alias:zustand={(VENDOR / 'zustand').as_posix()}",
        f"--alias:@mediapipe/tasks-vision={(VENDOR / '@mediapipe' / 'tasks-vision').as_posix()}",
    ]


def _esbuild_env() -> dict[str, str]:
    env = os.environ.copy()
    env["NODE_PATH"] = str(VENDOR)
    return env


def _esbuild_args(esbuild: Path, entry: Path, output: str, *extra: str) -> list[str]:
    return [
        str(esbuild),
        str(entry),
        "--bundle",
        output,
        f"--alias:@={SRC.as_posix()}",
        *_package_aliases(),
        "--target=es2022",
        # A plugin's vendored stylesheet may point at images (Leaflet's does).
        "--loader:.png=dataurl",
        "--loader:.svg=dataurl",
        "--log-level=warning",
        "--log-override:package.json=silent",
        *extra,
    ]


CHUNKS = RUNTIME / "chunks"


def bundle(esbuild: Path) -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    app_js = RUNTIME / "app.js"
    env = _esbuild_env()
    if _needs_bundle(app_js):
        _log("  bundle   src/main.ts -> public/.runtime/app.js (+ chunks/)")
        # Chunk names carry a content hash, so old ones would pile up forever.
        if CHUNKS.exists():
            shutil.rmtree(CHUNKS)
        subprocess.run(
            _esbuild_args(
                esbuild,
                SRC / "main.ts",
                f"--outdir={RUNTIME}",
                "--format=esm",
                # A plugin's `await import()` becomes its own file under
                # chunks/, fetched the first time the plugin is switched on.
                "--splitting",
                "--entry-names=app",
                "--chunk-names=chunks/[name]-[hash]",
                "--minify",
                "--sourcemap",
            ),
            cwd=PROJECT,
            env=env,
            check=True,
        )
    else:
        _log("  bundle   app.js is current")

    for entry in _worker_entries():
        dest = RUNTIME / "workers" / Path(entry).with_suffix(".js")
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and not _needs_bundle(dest):
            continue
        _log(f"  bundle   {entry} (classic worker)")
        subprocess.run(
            _esbuild_args(
                esbuild,
                SRC / entry,
                f"--outfile={dest}",
                "--format=iife",
                "--platform=browser",
                "--minify",
            ),
            cwd=PROJECT,
            env=env,
            check=True,
        )


def prepare_frontend() -> None:
    _log("Preparing frontend (no Node.js)")
    specs = _package_specs()
    for name in ("three", "zod", "zustand", "@mediapipe/tasks-vision"):
        if name not in specs:
            raise RuntimeError(f"{name} missing from vendor.json")
        ensure_package(name, specs[name])
    prepare_plugin_packages()
    mediapipe = VENDOR / "@mediapipe" / "tasks-vision"
    copy_mediapipe_wasm(mediapipe)
    prepare_models()
    esbuild = ensure_esbuild(specs["esbuild"])
    bundle(esbuild)
    _log("Frontend ready")


def lan_ips() -> list[str]:
    found = ["127.0.0.1"]
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("8.8.8.8", 80))
            found.append(probe.getsockname()[0])
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            found.append(info[4][0])
    except OSError:
        pass
    unique: list[str] = []
    for ip in found:
        if ip not in unique:
            unique.append(ip)
    return unique


def ensure_cert() -> tuple[Path, Path]:
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID

    CERTS.mkdir(parents=True, exist_ok=True)
    cert_path = CERTS / "dev-cert.pem"
    key_path = CERTS / "dev-key.pem"
    names = ["localhost", *lan_ips()]
    if cert_path.exists() and key_path.exists():
        try:
            loaded = x509.load_pem_x509_certificate(cert_path.read_bytes())
            san = loaded.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
            have = {str(item.value) for item in san}
            try:
                expiry = loaded.not_valid_after_utc
            except AttributeError:
                expiry = loaded.not_valid_after.replace(tzinfo=timezone.utc)
            if set(names) <= have and expiry > datetime.now(timezone.utc) + timedelta(days=1):
                return cert_path, key_path
        except Exception:  # noqa: BLE001
            pass

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    hostnames = [name for name in names if _is_hostname(name)]
    ips = [name for name in names if not _is_hostname(name)]
    alt = [x509.DNSName(name) for name in hostnames] + [x509.IPAddress(ip_address(name)) for name in ips]
    now = datetime.now(timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "VR Core")]))
        .issuer_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "VR Core")]))
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=365))
        .add_extension(x509.SubjectAlternativeName(alt), critical=False)
        .sign(key, hashes.SHA256())
    )
    key_path.write_bytes(
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.TraditionalOpenSSL,
            serialization.NoEncryption(),
        ),
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return cert_path, key_path


def _is_hostname(value: str) -> bool:
    try:
        ip_address(value)
    except ValueError:
        return True
    return False


class _PolicyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["Permissions-Policy"] = PERMISSIONS_POLICY
        return response


def _index_html() -> str:
    html = (PROJECT / "index.html").read_text(encoding="utf-8")
    html = html.replace('src="/src/main.ts"', 'src="/app.js"')
    if (RUNTIME / "app.css").exists() and "app.css" not in html:
        html = html.replace("</head>", '    <link rel="stylesheet" href="/app.css" />\n  </head>')
    return html


def attach_frontend(app: FastAPI) -> None:
    app.add_middleware(_PolicyMiddleware)

    @app.get("/", include_in_schema=False)
    def index() -> HTMLResponse:
        return HTMLResponse(_index_html())

    @app.get("/app.js", include_in_schema=False)
    def app_js() -> FileResponse:
        path = RUNTIME / "app.js"
        if not path.exists():
            raise HTTPException(status_code=503, detail="frontend not bundled")
        return FileResponse(path, media_type="text/javascript", headers={"Cache-Control": "no-cache"})

    @app.get("/app.css", include_in_schema=False)
    def app_css() -> FileResponse:
        path = RUNTIME / "app.css"
        if not path.exists():
            raise HTTPException(status_code=404)
        return FileResponse(path, media_type="text/css", headers={"Cache-Control": "no-cache"})

    @app.get("/app.js.map", include_in_schema=False)
    def app_map() -> FileResponse:
        path = RUNTIME / "app.js.map"
        if not path.exists():
            raise HTTPException(status_code=404)
        return FileResponse(path, media_type="application/json")

    @app.get("/chunks/{chunk_path:path}", include_in_schema=False)
    def chunk(chunk_path: str) -> FileResponse:
        # Plugins split out of app.js; `import("./chunks/...")` resolves here.
        dest = (CHUNKS / chunk_path).resolve()
        root = CHUNKS.resolve()
        if not str(dest).startswith(str(root) + os.sep) or not dest.is_file():
            raise HTTPException(status_code=404)
        media = "application/json" if dest.suffix == ".map" else "text/javascript"
        if dest.suffix == ".css":
            media = "text/css"
        # The name changes whenever the content does.
        return FileResponse(dest, media_type=media, headers={"Cache-Control": "public, max-age=31536000, immutable"})

    @app.get("/plugins/{plugin_id}/models/{file_name}", include_in_schema=False)
    def plugin_model(plugin_id: str, file_name: str) -> FileResponse:
        # Only what that plugin's own models.json declares, from its own folder.
        folder = SRC / "modules" / plugin_id
        if "/" in plugin_id or "\\" in plugin_id or plugin_id.startswith(".") or not folder.is_dir():
            raise HTTPException(status_code=404)
        if file_name not in {item["file"] for item in _declared_files(folder)}:
            raise HTTPException(status_code=404)
        dest = folder / PLUGIN_MODELS_DIR / file_name
        if not dest.is_file():
            raise HTTPException(status_code=404)
        return FileResponse(dest, headers={"Cache-Control": "public, max-age=31536000, immutable"})

    @app.get("/favicon.ico", include_in_schema=False)
    def favicon() -> Response:
        return Response(status_code=204)

    @app.get("/@classic-worker/{worker_path:path}", include_in_schema=False)
    def classic_worker(worker_path: str) -> FileResponse:
        relative = Path(worker_path)
        if ".." in relative.parts:
            raise HTTPException(status_code=400)
        dest = (RUNTIME / "workers" / relative).with_suffix(".js").resolve()
        root = (RUNTIME / "workers").resolve()
        if not str(dest).startswith(str(root) + os.sep) and dest != root:
            raise HTTPException(status_code=400)
        if not dest.exists():
            raise HTTPException(status_code=404)
        return FileResponse(dest, media_type="text/javascript", headers={"Cache-Control": "no-cache"})

    PUBLIC.mkdir(parents=True, exist_ok=True)

    @app.get("/{full_path:path}", include_in_schema=False)
    def public_file(full_path: str) -> FileResponse:
        dest = (PUBLIC / full_path).resolve()
        root = PUBLIC.resolve()
        if not str(dest).startswith(str(root) + os.sep):
            raise HTTPException(status_code=400)
        if not dest.is_file():
            raise HTTPException(status_code=404)
        relative = dest.relative_to(root).as_posix()
        headers = {}
        if relative.startswith("models/") or relative.startswith("mediapipe/"):
            headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return FileResponse(dest, headers=headers)
