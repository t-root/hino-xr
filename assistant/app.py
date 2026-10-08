"""HTTP surface for the assistant. All model work stays in this process."""

from __future__ import annotations

import base64
import io
import json
import wave
from collections.abc import Iterator
from typing import Any, Optional

from fastapi.concurrency import iterate_in_threadpool, run_in_threadpool
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from models.catalog import assistant_name, catalog
from models.engine import engine, parse_messages, resolve, sse
from models.speech import speech
from models.tuning import VoiceTuning, voice_spec
from models.wake import find_phrase, letters, question_after, wake_spec
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


class PreviewBody(BaseModel):
    text: str = Field(min_length=1, max_length=200)
    locale: str = "vi"


def _locale(value: str) -> str:
    return value if value in {"vi", "en"} else "vi"


def _short(wav: bytes) -> bool:
    """A line of about three seconds or less: cheap enough to read twice."""
    try:
        with wave.open(io.BytesIO(wav)) as clip:
            return clip.getnframes() / float(clip.getframerate()) <= 3.0
    except (wave.Error, EOFError, ZeroDivisionError):
        return False


def _range(name: str) -> dict[str, float]:
    return voice_spec()[name]


def _tuning(
    pitchHz: float = Query(_range("pitchHz")["default"], ge=_range("pitchHz")["min"], le=_range("pitchHz")["max"]),
    speed: float = Query(_range("speed")["default"], ge=_range("speed")["min"], le=_range("speed")["max"]),
    expression: float = Query(
        _range("expression")["default"], ge=_range("expression")["min"], le=_range("expression")["max"]
    ),
    rhythm: float = Query(_range("rhythm")["default"], ge=_range("rhythm")["min"], le=_range("rhythm")["max"]),
    pause: float = Query(_range("pause")["default"], ge=_range("pause")["min"], le=_range("pause")["max"]),
) -> VoiceTuning:
    """How the reply sounds, from the query string. Missing values are the defaults."""
    return VoiceTuning(pitch_hz=pitchHz, speed=speed, expression=expression, rhythm=rhythm, pause=pause)


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
def complete(model_id: str, body: CompleteBody, tuning: VoiceTuning = Depends(_tuning)) -> StreamingResponse:
    try:
        spec = resolve(model_id)
        messages = parse_messages(body.messages)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="unknown model") from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return _sse(engine.reply(spec, messages, body.maxTokens, body.voice, _locale(body.locale), tuning))


@app.post("/api/models/{model_id}/wake")
def wake(
    model_id: str,
    locale: str = "vi",
    greeting: Optional[str] = Query(None, max_length=200),
    tuning: VoiceTuning = Depends(_tuning),
) -> StreamingResponse:
    try:
        spec = resolve(model_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="unknown model") from error
    return _sse(engine.wake(spec, _locale(locale), tuning, greeting))


@app.post("/api/models/{model_id}/talk")
async def talk(
    model_id: str,
    request: Request,
    locale: str = "vi",
    stripWake: bool = False,
    tuning: VoiceTuning = Depends(_tuning),
) -> StreamingResponse:
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
    return _sse(engine.talk(spec, wav, _locale(locale), history, tuning, stripWake))


@app.post("/api/voice/preview")
def preview_voice(body: PreviewBody, tuning: VoiceTuning = Depends(_tuning)) -> Response:
    """Speak one line with the given tuning, without the language model."""
    try:
        wav = speech.synthesize(body.text, _locale(body.locale), tuning)
    except Exception as error:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=str(error)) from error
    if not wav:
        raise HTTPException(status_code=422, detail="nothing to say")
    return Response(content=wav, media_type="audio/wav")


@app.post("/api/voice/listen")
async def listen(request: Request, expect: str = "wake", locale: str = "vi") -> dict[str, Any]:
    """Is the spoken line the word that wakes the system ("system call") or the assistant (its name)?

    `after` counts the words that came after it, so the page can tell a bare call from
    a call with the question already attached.
    """
    if expect not in {"system", "wake"}:
        raise HTTPException(status_code=400, detail="expect must be system or wake")
    wav = await request.body()
    if not wav:
        raise HTTPException(status_code=400, detail="empty audio")
    if len(wav) > MAX_WAV:
        raise HTTPException(status_code=413, detail="audio too large")
    phrase = wake_spec()["systemCall"] if expect == "system" else assistant_name()
    own = "vi" if _locale(locale) == "vi" else "en"
    # "System call" is English whoever says it. A name is first tried in the wearer's own
    # language; a short line that misses is tried again in the other, because a name
    # said in Vietnamese is often written down better by the English reading of it.
    languages = ["en"] if expect == "system" else [own, "en" if own == "vi" else "vi"]
    heard, matched, rest = "", False, []
    for index, language in enumerate(languages):
        if index and not _short(wav):
            break
        try:
            heard = await run_in_threadpool(
                speech.transcribe, wav, _locale(locale), language, f"{phrase.title()}."
            )
        except Exception as error:  # noqa: BLE001
            raise HTTPException(status_code=503, detail=str(error)) from error
        matched, rest = find_phrase(heard, phrase)
        if matched:
            break
    after = [word for word in question_after(rest) if letters(word)]
    return {"heard": heard, "matched": matched, "after": len(after)}


attach_frontend(app)
