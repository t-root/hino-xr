import spec from "../voice.json";
import { clamp } from "../math/num";

export type VoiceSettings = Readonly<{
  pitchHz: number;
  speed: number;
  expression: number;
  rhythm: number;
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

export const voiceQuery = (voice: VoiceSettings): string =>
  VOICE_KEYS.map((key) => `${key}=${encodeURIComponent(String(voice[key]))}`).join("&");
