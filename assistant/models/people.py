"""People the headset knows by face: a name, a year of birth, a note, and what their face looks like.

What a face looks like is a short list of numbers the page works out (an embedding): two photos of one person
give lists that are close, photos of two people give lists that are far apart. The page does the matching; this
only keeps the lists, with the person's details, in one file on this computer so nothing is lost when the page
is closed. No picture of a face is ever sent or stored.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

DATA_FILE = Path(__file__).resolve().parents[1] / "data" / "people.json"

MAX_NAME = 80
MAX_INFO = 400
MIN_YEAR = 1900
#: Samples of one face kept for one person, newest last: more angles and lighting make it recognised more often.
MAX_SAMPLES = 12
MIN_DIMENSIONS = 16
MAX_DIMENSIONS = 1024


class PersonError(ValueError):
    """What was given is not a usable person; the message says why, for a log and a test."""


def _year(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        year = int(value)
    except (TypeError, ValueError) as error:
        raise PersonError("year of birth must be a number") from error
    if not MIN_YEAR <= year <= datetime.now().year:
        raise PersonError(f"year of birth must be between {MIN_YEAR} and {datetime.now().year}")
    return year


def _text(value: Any, limit: int, field: str) -> str:
    text = " ".join(str(value or "").split())
    if len(text) > limit:
        raise PersonError(f"{field} is longer than {limit} characters")
    return text


def _embedding(value: Any) -> list[float]:
    if not isinstance(value, list) or not MIN_DIMENSIONS <= len(value) <= MAX_DIMENSIONS:
        raise PersonError("embedding must be a list of numbers")
    try:
        numbers = [round(float(item), 5) for item in value]
    except (TypeError, ValueError) as error:
        raise PersonError("embedding must be a list of numbers") from error
    if any(number != number or abs(number) > 1e6 for number in numbers):
        raise PersonError("embedding holds a number that is not usable")
    return numbers


class People:
    def __init__(self, path: Path = DATA_FILE) -> None:
        self._path = path
        self._lock = threading.Lock()

    def _read(self) -> list[dict[str, Any]]:
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        people = raw.get("people") if isinstance(raw, dict) else None
        return [item for item in people if isinstance(item, dict)] if isinstance(people, list) else []

    def _write(self, people: list[dict[str, Any]]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        # Written beside and moved over, so a crash half way never leaves a half-written file.
        handle, name = tempfile.mkstemp(dir=self._path.parent, suffix=".tmp")
        try:
            with os.fdopen(handle, "w", encoding="utf-8") as out:
                json.dump({"people": people}, out, ensure_ascii=False)
            os.replace(name, self._path)
        except BaseException:
            Path(name).unlink(missing_ok=True)
            raise

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            return self._read()

    def create(self, name: Any, year: Any = None, info: Any = "", embedding: Any = None) -> dict[str, Any]:
        clean = _text(name, MAX_NAME, "name")
        if not clean:
            raise PersonError("a person needs a name")
        person: dict[str, Any] = {
            "id": uuid.uuid4().hex[:12],
            "name": clean,
            "year": _year(year),
            "info": _text(info, MAX_INFO, "info"),
            "samples": [_embedding(embedding)] if embedding is not None else [],
        }
        with self._lock:
            people = self._read()
            people.append(person)
            self._write(people)
        return person

    def update(self, person_id: str, **fields: Any) -> dict[str, Any]:
        """Changes the details named; a field left out stays as it was, and `year=None` clears the year."""
        with self._lock:
            people = self._read()
            person = next((item for item in people if item.get("id") == person_id), None)
            if person is None:
                raise KeyError(person_id)
            if "name" in fields:
                clean = _text(fields["name"], MAX_NAME, "name")
                if not clean:
                    raise PersonError("a person needs a name")
                person["name"] = clean
            if "year" in fields:
                person["year"] = _year(fields["year"])
            if "info" in fields:
                person["info"] = _text(fields["info"], MAX_INFO, "info")
            self._write(people)
            return person

    def add_sample(self, person_id: str, embedding: Any) -> dict[str, Any]:
        sample = _embedding(embedding)
        with self._lock:
            people = self._read()
            person = next((item for item in people if item.get("id") == person_id), None)
            if person is None:
                raise KeyError(person_id)
            samples = [item for item in person.get("samples", []) if isinstance(item, list)]
            if samples and len(samples[0]) != len(sample):
                raise PersonError("embedding has a different length from the ones kept")
            person["samples"] = [*samples, sample][-MAX_SAMPLES:]
            self._write(people)
            return person

    def delete(self, person_id: str) -> bool:
        with self._lock:
            people = self._read()
            kept = [item for item in people if item.get("id") != person_id]
            if len(kept) == len(people):
                return False
            self._write(kept)
            return True


people = People()
