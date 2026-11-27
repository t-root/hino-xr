
from __future__ import annotations

import re

_SENTENCE = re.compile(r"(?s)^(.*?[.!?…]+[\"')»\]]*)(?:\s+)")
_NEWLINE = re.compile(r"(?s)^(.*?)\n+")
_CLAUSE = re.compile(r"(?s)^(.{15,}?[,;:])\s+")
CLAUSE_FROM = 40
RUN_ON = 200


def next_chunk(buffer: str, first: bool) -> tuple[str, str] | None:
    for pattern in (_SENTENCE, _NEWLINE):
        found = pattern.match(buffer)
        if found and found.group(1).strip():
            return found.group(1).strip(), buffer[found.end():]
    if first and len(buffer) >= CLAUSE_FROM:
        found = _CLAUSE.match(buffer)
        if found:
            return found.group(1).strip(), buffer[found.end():]
    if len(buffer) > RUN_ON:
        cut = buffer.rfind(" ", 0, RUN_ON)
        if cut > 0:
            return buffer[:cut].strip(), buffer[cut + 1:]
    return None
