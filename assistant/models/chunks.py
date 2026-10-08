"""Cut a growing reply into pieces that can be spoken while the model keeps writing."""

from __future__ import annotations

import re

_SENTENCE = re.compile(r"(?s)^(.*?[.!?…]+[\"')»\]]*)(?:\s+)")
_NEWLINE = re.compile(r"(?s)^(.*?)\n+")
_CLAUSE = re.compile(r"(?s)^(.{15,}?[,;:])\s+")
CLAUSE_FROM = 40
RUN_ON = 200


def next_chunk(buffer: str, first: bool) -> tuple[str, str] | None:
    """The next piece worth speaking and what is left, or None to wait for more text.

    A sentence is ready once whitespace follows its full stop, so "25.5" is not cut.
    The first piece may also end at a comma: the wearer hears something sooner, and
    a clause is a natural place to pause. A reply that never stops is cut at a space.
    """
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
