import { isTurn, type Turn } from "../view/orientation";
import { DEFAULT_THEME, isHexColor, type ThemeSettings } from "@/ui/theme";
import { clamp, clamp01 } from "@/shared/math/num";
import { DEFAULT_VOICE, parseVoice, type VoiceSettings } from "@/shared/contracts/voice";
import { DEFAULT_LISTEN_SECONDS, parseListenSeconds } from "@/shared/contracts/wake";
import {
  ACK,
  DEFAULT_FAILED,
  DEFAULT_GREETING,
  DEFAULT_LOOKING,
  DEFAULT_NO_CODE,
  DEFAULT_NO_SCENE,
} from "../models/identity";
import { LOCALES, type Locale } from "@/shared/contracts/locale";

export type GestureSettings = Readonly<{
  trackingConfidence: number;
  trackingWarmupFrames: number;
  hoverDwellMs: number;
  pinchEnterRatio: number;
  pinchExitRatio: number;
  pinchOpenDelta: number;
  pinchEnterHoldMs: number;
  pinchExitHoldMs: number;
  dragThreshold: number;
  dragHoldMs: number;
  lostTimeoutMs: number;
  sensitivity: number;
}>;

export type SnapSettings = Readonly<{
  contactRatio: number;
  contactHoldMs: number;
  releaseRatio: number;
  velocityThreshold: number;
  palmRatio: number;
  windowMs: number;
  cooldownMs: number;
}>;

export type RenderSettings = Readonly<{
  ipdMeters: number;
  videoPlaneDistance: number;
  uiPlaneDistance: number;
  maxBatchAgeMs: number;
  showDiagnostics: boolean;
  mirrorFrontCamera: boolean;
  softEdge: boolean;
}>;

export type LensSettings = Readonly<{
  fovYDeg: number;
  eyeGapPx: number;
  lensCenterOffset: number;
  k1: number;
  k2: number;
  frameScale: number;
}>;

type PipelineSettings = Readonly<{
  handTrackingFps: number;
  moduleFps: number;
  analysisMaxSize: number;
}>;

type AssistantSettings = Readonly<{
  enabled: boolean;
  modelId: string;
  voice: VoiceSettings;
  listenSeconds: number;
  bargeIn: boolean;
  greeting: Readonly<Record<Locale, string>>;
  ack: Readonly<Record<Locale, string>>;
  looking: Readonly<Record<Locale, string>>;
  failed: Readonly<Record<Locale, string>>;
  noScene: Readonly<Record<Locale, string>>;
  noCode: Readonly<Record<Locale, string>>;
}>;

export const GREETING_MAX = 120;

type FeatureFlags = Readonly<{
  snapGesture: boolean;
  webxr: boolean;
  handTracking: boolean;
}>;

type CursorSettings = Readonly<{
  opacity: number;
  scale: number;
}>;

type ViewSettings = Readonly<{
  rotation: Turn;
  autoRotate: boolean;
}>;

export type Settings = Readonly<{
  gesture: GestureSettings;
  snap: SnapSettings;
  cursor: CursorSettings;
  view: ViewSettings;
  theme: ThemeSettings;
  render: RenderSettings;
  lens: LensSettings;
  pipeline: PipelineSettings;
  flags: FeatureFlags;
  assistant: AssistantSettings;
}>;

export const DEFAULT_LENS: LensSettings = {
  fovYDeg: 70,
  eyeGapPx: 0,
  lensCenterOffset: 0,
  k1: 0.2,
  k2: 0.05,
  frameScale: 0.9,
};

export const DEFAULT_SETTINGS: Settings = {
  gesture: {
    trackingConfidence: 0.7,
    trackingWarmupFrames: 2,
    hoverDwellMs: 80,
    pinchEnterRatio: 0.4,
    pinchExitRatio: 0.55,
    pinchOpenDelta: 0.08,
    pinchEnterHoldMs: 16,
    pinchExitHoldMs: 24,
    dragThreshold: 0.05,
    dragHoldMs: 500,
    lostTimeoutMs: 150,
    sensitivity: 1,
  },
  snap: {
    contactRatio: 0.45,
    contactHoldMs: 40,
    releaseRatio: 0.7,
    velocityThreshold: 5,
    palmRatio: 1.25,
    windowMs: 320,
    cooldownMs: 450,
  },
  cursor: {
    opacity: 0.9,
    scale: 1,
  },
  view: {
    rotation: 0,
    autoRotate: true,
  },
  theme: DEFAULT_THEME,
  render: {
    ipdMeters: 0.064,
    videoPlaneDistance: 3,
    uiPlaneDistance: 1.6,
    maxBatchAgeMs: 600,
    showDiagnostics: true,
    mirrorFrontCamera: true,
    softEdge: false,
  },
  lens: DEFAULT_LENS,
  pipeline: {
    handTrackingFps: 24,
    moduleFps: 10,
    analysisMaxSize: 512,
  },
  flags: {
    snapGesture: true,
    webxr: true,
    handTracking: true,
  },
  assistant: {
    enabled: true,
    modelId: "assistant",
    voice: DEFAULT_VOICE,
    listenSeconds: DEFAULT_LISTEN_SECONDS,
    bargeIn: false,
    greeting: DEFAULT_GREETING,
    ack: ACK,
    looking: DEFAULT_LOOKING,
    failed: DEFAULT_FAILED,
    noScene: DEFAULT_NO_SCENE,
    noCode: DEFAULT_NO_CODE,
  },
};

const STORAGE_KEY = "vr-core.settings.v1";

const VOICE_MODEL_KEY = "vr-core.voice-model";
const VOICE_MODEL = "vieneu-turbo";

const migrateRender = (render: RenderSettings): RenderSettings =>
  render.maxBatchAgeMs === 250 ? { ...render, maxBatchAgeMs: DEFAULT_SETTINGS.render.maxBatchAgeMs } : render;

const migrateVoice = (assistant: AssistantSettings): AssistantSettings =>
  localStorage.getItem(VOICE_MODEL_KEY) === VOICE_MODEL ? assistant : { ...assistant, voice: DEFAULT_VOICE };

export const loadSettings = (): Settings => {
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const gestureIn = parsed.gesture ?? {};
    const gesture = { ...DEFAULT_SETTINGS.gesture, ...gestureIn };
    if (!("pinchOpenDelta" in gestureIn)) {
      gesture.pinchEnterRatio = DEFAULT_SETTINGS.gesture.pinchEnterRatio;
      gesture.pinchExitRatio = DEFAULT_SETTINGS.gesture.pinchExitRatio;
      gesture.pinchOpenDelta = DEFAULT_SETTINGS.gesture.pinchOpenDelta;
    }
    if (gesture.pinchEnterRatio <= 0.25) {
      gesture.pinchEnterRatio = DEFAULT_SETTINGS.gesture.pinchEnterRatio;
      gesture.pinchExitRatio = DEFAULT_SETTINGS.gesture.pinchExitRatio;
      gesture.pinchOpenDelta = DEFAULT_SETTINGS.gesture.pinchOpenDelta;
      gesture.pinchEnterHoldMs = DEFAULT_SETTINGS.gesture.pinchEnterHoldMs;
      gesture.pinchExitHoldMs = DEFAULT_SETTINGS.gesture.pinchExitHoldMs;
    }
    const snapIn = parsed.snap ?? {};
    const snap = { ...DEFAULT_SETTINGS.snap, ...snapIn };
    if (
      (snap.contactRatio <= 0.36 && snap.velocityThreshold >= 8) ||
      snap.palmRatio <= 1.05 ||
      snap.contactHoldMs >= 70
    ) {
      snap.contactRatio = DEFAULT_SETTINGS.snap.contactRatio;
      snap.contactHoldMs = DEFAULT_SETTINGS.snap.contactHoldMs;
      snap.velocityThreshold = DEFAULT_SETTINGS.snap.velocityThreshold;
      snap.palmRatio = DEFAULT_SETTINGS.snap.palmRatio;
      snap.windowMs = DEFAULT_SETTINGS.snap.windowMs;
    }
    const viewIn = parsed.view as { rotation?: unknown; autoRotate?: unknown } | undefined;
    const viewRotation = viewIn?.rotation;
    return {
      gesture,
      snap,
      cursor: { ...DEFAULT_SETTINGS.cursor, ...parsed.cursor },
      view: {
        rotation: isTurn(viewRotation) ? viewRotation : DEFAULT_SETTINGS.view.rotation,
        autoRotate: typeof viewIn?.autoRotate === "boolean" ? viewIn.autoRotate : DEFAULT_SETTINGS.view.autoRotate,
      },
      theme: parseTheme((parsed as { theme?: unknown }).theme),
      render: migrateRender({ ...DEFAULT_SETTINGS.render, ...parsed.render }),
      lens: parseLens(parsed.lens),
      pipeline: { ...DEFAULT_SETTINGS.pipeline, ...parsed.pipeline },
      flags: { ...DEFAULT_SETTINGS.flags, ...parsed.flags },
      assistant: migrateVoice(parseAssistant((parsed as { assistant?: unknown }).assistant)),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

const parseLens = (raw: unknown): LensSettings => {
  if (!raw || typeof raw !== "object") return DEFAULT_LENS;
  const value = raw as Partial<LensSettings>;
  return {
    fovYDeg: typeof value.fovYDeg === "number" ? value.fovYDeg : DEFAULT_LENS.fovYDeg,
    eyeGapPx: typeof value.eyeGapPx === "number" ? value.eyeGapPx : DEFAULT_LENS.eyeGapPx,
    lensCenterOffset:
      typeof value.lensCenterOffset === "number" ? value.lensCenterOffset : DEFAULT_LENS.lensCenterOffset,
    k1: typeof value.k1 === "number" ? value.k1 : DEFAULT_LENS.k1,
    k2: typeof value.k2 === "number" ? value.k2 : DEFAULT_LENS.k2,
    frameScale: clamp(readFrameScale(value), 0.5, 1),
  };
};

const readFrameScale = (value: Partial<LensSettings> & { viewScale?: number }): number => {
  if (typeof value.frameScale === "number") return value.frameScale;
  if (typeof value.viewScale === "number") return value.viewScale;
  return DEFAULT_LENS.frameScale;
};

const parseLines = (raw: unknown, defaults: Readonly<Record<Locale, string>>): Readonly<Record<Locale, string>> => {
  const saved = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    LOCALES.map((locale) => {
      const text = saved[locale];
      return [locale, typeof text === "string" ? text.slice(0, GREETING_MAX) : defaults[locale]];
    }),
  ) as Record<Locale, string>;
};

const parseAssistant = (raw: unknown): AssistantSettings => {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS.assistant;
  const value = raw as Record<string, unknown>;
  const modelId = typeof value.modelId === "string" ? value.modelId.trim() : "";
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_SETTINGS.assistant.enabled,
    modelId: modelId.length > 0 ? modelId : DEFAULT_SETTINGS.assistant.modelId,
    voice: parseVoice(value.voice),
    listenSeconds: parseListenSeconds(value.listenSeconds),
    bargeIn: typeof value.bargeIn === "boolean" ? value.bargeIn : DEFAULT_SETTINGS.assistant.bargeIn,
    greeting: parseLines(value.greeting, DEFAULT_GREETING),
    ack: parseLines(value.ack, ACK),
    looking: parseLines(value.looking, DEFAULT_LOOKING),
    failed: parseLines(value.failed, DEFAULT_FAILED),
    noScene: parseLines(value.noScene, DEFAULT_NO_SCENE),
    noCode: parseLines(value.noCode, DEFAULT_NO_CODE),
  };
};

const parseTheme = (raw: unknown): ThemeSettings => {
  if (!raw || typeof raw !== "object") return DEFAULT_THEME;
  const theme = raw as Record<string, unknown>;
  return {
    primary: isHexColor(theme.primary) ? theme.primary.toLowerCase() : DEFAULT_THEME.primary,
    primaryOpacity:
      typeof theme.primaryOpacity === "number" ? clamp01(theme.primaryOpacity) : DEFAULT_THEME.primaryOpacity,
    accent: isHexColor(theme.accent) ? theme.accent.toLowerCase() : DEFAULT_THEME.accent,
    accentOpacity:
      typeof theme.accentOpacity === "number" ? clamp01(theme.accentOpacity) : DEFAULT_THEME.accentOpacity,
  };
};

export const persistSettings = (settings: Settings): void => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    localStorage.setItem(VOICE_MODEL_KEY, VOICE_MODEL);
  } catch {
  }
};
