import spec from "../voice.json";
import { clamp } from "../math/num";

/**
 * How the assistant sounds, as the wearer sets it. The ranges and defaults are
 * `src/shared/voice.json`, which the model server reads too, so the sliders and
 * the server's limits cannot disagree.
 */
export type VoiceSettings = Readonly<{
  /** Pitch of the Vietnamese voice, in Hz. */
  pitchHz: number;
  /** Speaking rate; 1 is natural. */
  speed: number;
  /** How much the melody varies. */
  expression: number;
  /** How much the length of each sound varies. */
  rhythm: number;
  /** The gap left between sentences. */
  pause: number;
}>;

type VoiceKey = keyof VoiceSettings;

export const VOICE_KEYS: readonly VoiceKey[] = ["pitchHz", "speed", "expression", "rhythm", "pause"];

export const VOICE_RANGE: Readonly<Record<VoiceKey, Readonly<{ min: number; max: number; step: number }>>> = spec;

export const DEFAULT_VOICE: VoiceSettings = {
  pitchHz: spec.pitchHz.default,
  speed: spec.speed.default,
  expression: spec.expression.default,
  rhythm: spec.rhythm.default,
  pause: spec.pause.default,
};

/** Reads saved settings; anything missing or out of range falls back or is clamped. */
export const parseVoice = (raw: unknown): VoiceSettings => {
  if (!raw || typeof raw !== "object") return DEFAULT_VOICE;
  const value = raw as Record<string, unknown>;
  const read = (key: VoiceKey): number => {
    const saved = value[key];
    if (typeof saved !== "number" || !Number.isFinite(saved)) return DEFAULT_VOICE[key];
    return clamp(saved, VOICE_RANGE[key].min, VOICE_RANGE[key].max);
  };
  return {
    pitchHz: read("pitchHz"),
    speed: read("speed"),
    expression: read("expression"),
    rhythm: read("rhythm"),
    pause: read("pause"),
  };
};

/** The tuning as a query string, `?pitchHz=215&…`. */
export const voiceQuery = (voice: VoiceSettings): string =>
  VOICE_KEYS.map((key) => `${key}=${encodeURIComponent(String(voice[key]))}`).join("&");
