"""How the assistant sounds. The wearer sets these in the menu.

Ranges and defaults are written once, in src/shared/voice.json, and read by the
web as well.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

_VOICE_JSON = Path(__file__).resolve().parents[2] / "src" / "shared" / "voice.json"


@lru_cache(maxsize=1)
def voice_spec() -> dict[str, Any]:
    return json.loads(_VOICE_JSON.read_text(encoding="utf-8"))


@dataclass(frozen=True)
class VoiceTuning:
    pitch_hz: float
    """Pitch of the Vietnamese voice."""
    speed: float
    """Speaking rate. Also applies to the English voice."""
    expression: float
    """VieNeu temperature: how much the melody varies."""
    rhythm: float
    """VieNeu top_p: how wide a choice of sounds it draws from; lower is steadier."""
    pause: float
    """VieNeu silence_p: how likely a pause is between phrases."""


def default_tuning() -> VoiceTuning:
    spec = voice_spec()
    return VoiceTuning(
        pitch_hz=spec["pitchHz"]["default"],
        speed=spec["speed"]["default"],
        expression=spec["expression"]["default"],
        rhythm=spec["rhythm"]["default"],
        pause=spec["pause"]["default"],
    )
