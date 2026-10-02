"""HTTP surface for the assistant. All model work stays in this process."""

from __future__ import annotations

import base64
import json
from collections.abc import Iterator
from typing import Any

from fastapi.concurrency import iterate_in_threadpool
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from models.catalog import assistant_name, catalog
from models.engine import engine, parse_messages, resolve, sse
from frontend import attach_frontend

app = FastAPI(title="VR assistant", version="0.1.0")

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}

MAX_WAV = 2_000_000


class CompleteBody(BaseModel):
    messages: list[dict[str, str]]
    maxTokens: int = Field(default=128, ge=8, le=512)
    voice: bool = False
    locale: str = "vi"


def _locale(value: str) -> str:
    return value if value in {"vi", "en"} else "vi"


def _sse(events: Iterator[dict[str, Any]]) -> StreamingResponse:
    def body():
        try:
            for event in events:
                yield sse(event)
            yield sse({"type": "done"})
        except Exception as error:  # noqa: BLE001
            yield sse({"type": "error", "error": str(error)})

    return StreamingResponse(
        iterate_in_threadpool(body()),
        media_type="text/event-stream",
        headers=SSE_HEADERS,
    )


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "name": assistant_name()}


@app.get("/api/models")
def list_models() -> dict:
    try:
        return {"models": [engine.snapshot(spec) for spec in catalog()]}
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(error)) from error


@app.get("/api/models/{model_id}")
def show_model(model_id: str) -> dict:
    try:
        spec = resolve(model_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="unknown model") from error
    return engine.snapshot(spec)


@app.post("/api/models/{model_id}/load")
def load_model(model_id: str) -> dict:
    try:
        spec = resolve(model_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="unknown model") from error
    try:
        engine.load(spec)
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(error)) from error
    return engine.snapshot(spec)


@app.post("/api/models/{model_id}/complete")
def complete(model_id: str, body: CompleteBody) -> StreamingResponse:
    try:
        spec = resolve(model_id)
        messages = parse_messages(body.messages)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="unknown model") from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return _sse(engine.reply(spec, messages, body.maxTokens, body.voice, _locale(body.locale)))


@app.post("/api/models/{model_id}/wake")
def wake(model_id: str, locale: str = "vi") -> StreamingResponse:
    try:
        spec = resolve(model_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="unknown model") from error
    return _sse(engine.wake(spec, _locale(locale)))


@app.post("/api/models/{model_id}/talk")
async def talk(model_id: str, request: Request, locale: str = "vi") -> StreamingResponse:
    try:
        spec = resolve(model_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="unknown model") from error
    raw = await request.body()
    if not raw:
        raise HTTPException(status_code=400, detail="empty audio")
    history: list[dict[str, str]] = []
    content_type = request.headers.get("content-type", "")
    if "application/json" in content_type:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=400, detail="invalid json") from error
        audio = payload.get("audio") if isinstance(payload, dict) else None
        if not isinstance(audio, str) or not audio:
            raise HTTPException(status_code=400, detail="empty audio")
        try:
            wav = base64.b64decode(audio)
        except ValueError as error:
            raise HTTPException(status_code=400, detail="invalid audio") from error
        messages = payload.get("messages") if isinstance(payload, dict) else None
        if messages:
            try:
                history = parse_messages(messages)
            except ValueError as error:
                raise HTTPException(status_code=400, detail=str(error)) from error
    else:
        wav = raw
    if not wav:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(wav) > MAX_WAV:
        raise HTTPException(status_code=413, detail="audio too large")
    return _sse(engine.talk(spec, wav, _locale(locale), history))


attach_frontend(app)
