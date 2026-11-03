import { message } from "@/i18n/text";
import names from "@/shared/voice-controls.json";
import { LISTEN_RANGE } from "@/shared/contracts/wake";
import { VOICE_RANGE } from "@/shared/contracts/voice";
import { LOCALES, type Locale } from "@/shared/contracts/locale";
import { useLocaleStore } from "../state/LocaleStore";
import { SETTINGS_CATEGORIES, useSharedUiStore, type SettingsCategory } from "../state/SharedUiStore";
import { DEFAULT_LENS, DEFAULT_SETTINGS, type Settings } from "../state/settings";

/** A control as the model server needs it to hear a spoken line: names, kind, range, where it stands. */
export type SpokenControl = Readonly<
  | {
      id: string;
      kind: "number";
      vi: readonly string[];
      en: readonly string[];
      unit: Readonly<{ vi: string; en: string }>;
      min: number;
      max: number;
      step: number;
      value: number;
      default: number;
    }
  | { id: string; kind: "toggle"; vi: readonly string[]; en: readonly string[]; value: boolean; open?: boolean }
  | { id: string; kind: "page"; vi: readonly string[]; en: readonly string[] }
  | {
      id: string;
      kind: "choice";
      vi: readonly string[];
      en: readonly string[];
      options: ReadonlyArray<{ value: string; vi: readonly string[]; en: readonly string[] }>;
    }
>;

/** What the headset lets a spoken line reach: its settings, and the switches that are not settings. */
export type ControlDeps = Readonly<{
  settings: () => Settings;
  apply: (settings: Settings) => void;
  stereoOn: () => boolean;
  setStereo: (on: boolean) => void;
}>;

type Range = Readonly<{ min: number; max: number; step: number }>;

type NumberEntry = Readonly<{
  id: string;
  range: Range;
  default: number;
  read: (s: Settings) => number;
  write: (s: Settings, v: number) => Settings;
}>;

type ToggleEntry = Readonly<{
  id: string;
  read: () => boolean;
  write: (on: boolean) => void;
}>;

const lens = (s: Settings, patch: Partial<Settings["lens"]>): Settings => ({ ...s, lens: { ...s.lens, ...patch } });
const voice = (s: Settings, patch: Partial<Settings["assistant"]["voice"]>): Settings => ({
  ...s,
  assistant: { ...s.assistant, voice: { ...s.assistant.voice, ...patch } },
});
const gesture = (s: Settings, patch: Partial<Settings["gesture"]>): Settings => ({
  ...s,
  gesture: { ...s.gesture, ...patch },
});
const cursor = (s: Settings, patch: Partial<Settings["cursor"]>): Settings => ({
  ...s,
  cursor: { ...s.cursor, ...patch },
});
const render = (s: Settings, patch: Partial<Settings["render"]>): Settings => ({
  ...s,
  render: { ...s.render, ...patch },
});
const pipeline = (s: Settings, patch: Partial<Settings["pipeline"]>): Settings => ({
  ...s,
  pipeline: { ...s.pipeline, ...patch },
});

const D = DEFAULT_SETTINGS;

/** The numbers the menu has sliders for, with the same ranges. Names are what a person would say. */
const NUMBERS: readonly NumberEntry[] = [
  {
    id: "lens.ipd",
    range: { min: 0.05, max: 0.08, step: 0.001 },
    default: D.render.ipdMeters,
    read: (s) => s.render.ipdMeters,
    write: (s, v) => render(s, { ipdMeters: v }),
  },
  {
    id: "lens.eyeGap",
    range: { min: 0, max: 80, step: 2 },
    default: DEFAULT_LENS.eyeGapPx,
    read: (s) => s.lens.eyeGapPx,
    write: (s, v) => lens(s, { eyeGapPx: v }),
  },
  {
    id: "lens.fov",
    range: { min: 45, max: 100, step: 1 },
    default: DEFAULT_LENS.fovYDeg,
    read: (s) => s.lens.fovYDeg,
    write: (s, v) => lens(s, { fovYDeg: v }),
  },
  {
    id: "lens.frameScale",
    range: { min: 0.5, max: 1, step: 0.01 },
    default: DEFAULT_LENS.frameScale,
    read: (s) => s.lens.frameScale,
    write: (s, v) => lens(s, { frameScale: v }),
  },
  {
    id: "lens.center",
    range: { min: -0.15, max: 0.15, step: 0.005 },
    default: DEFAULT_LENS.lensCenterOffset,
    read: (s) => s.lens.lensCenterOffset,
    write: (s, v) => lens(s, { lensCenterOffset: v }),
  },
  {
    id: "lens.uiDistance",
    range: { min: 1, max: 3, step: 0.05 },
    default: D.render.uiPlaneDistance,
    read: (s) => s.render.uiPlaneDistance,
    write: (s, v) => render(s, { uiPlaneDistance: v }),
  },
  {
    id: "gesture.sensitivity",
    range: { min: 0.6, max: 1.6, step: 0.05 },
    default: D.gesture.sensitivity,
    read: (s) => s.gesture.sensitivity,
    write: (s, v) => gesture(s, { sensitivity: v }),
  },
  {
    id: "gesture.drag",
    range: { min: 0.004, max: 0.04, step: 0.002 },
    default: D.gesture.dragThreshold,
    read: (s) => s.gesture.dragThreshold,
    write: (s, v) => gesture(s, { dragThreshold: v }),
  },
  {
    id: "gesture.hold",
    range: { min: 200, max: 1200, step: 50 },
    default: D.gesture.dragHoldMs,
    read: (s) => s.gesture.dragHoldMs,
    write: (s, v) => gesture(s, { dragHoldMs: v }),
  },
  {
    id: "cursor.opacity",
    range: { min: 0, max: 1, step: 0.05 },
    default: D.cursor.opacity,
    read: (s) => s.cursor.opacity,
    write: (s, v) => cursor(s, { opacity: v }),
  },
  {
    id: "cursor.size",
    range: { min: 0.5, max: 2, step: 0.05 },
    default: D.cursor.scale,
    read: (s) => s.cursor.scale,
    write: (s, v) => cursor(s, { scale: v }),
  },
  {
    id: "pipeline.handFps",
    range: { min: 8, max: 30, step: 1 },
    default: D.pipeline.handTrackingFps,
    read: (s) => s.pipeline.handTrackingFps,
    write: (s, v) => pipeline(s, { handTrackingFps: v }),
  },
  {
    id: "pipeline.moduleFps",
    range: { min: 2, max: 20, step: 1 },
    default: D.pipeline.moduleFps,
    read: (s) => s.pipeline.moduleFps,
    write: (s, v) => pipeline(s, { moduleFps: v }),
  },
  {
    id: "pipeline.analysisSize",
    range: { min: 256, max: 768, step: 32 },
    default: D.pipeline.analysisMaxSize,
    read: (s) => s.pipeline.analysisMaxSize,
    write: (s, v) => pipeline(s, { analysisMaxSize: v }),
  },
  {
    id: "assistant.listen",
    range: LISTEN_RANGE,
    default: D.assistant.listenSeconds,
    read: (s) => s.assistant.listenSeconds,
    write: (s, v) => ({ ...s, assistant: { ...s.assistant, listenSeconds: v } }),
  },
  {
    id: "voice.pitch",
    range: VOICE_RANGE.pitchHz,
    default: D.assistant.voice.pitchHz,
    read: (s) => s.assistant.voice.pitchHz,
    write: (s, v) => voice(s, { pitchHz: v }),
  },
  {
    id: "voice.speed",
    range: VOICE_RANGE.speed,
    default: D.assistant.voice.speed,
    read: (s) => s.assistant.voice.speed,
    write: (s, v) => voice(s, { speed: v }),
  },
  {
    id: "voice.expression",
    range: VOICE_RANGE.expression,
    default: D.assistant.voice.expression,
    read: (s) => s.assistant.voice.expression,
    write: (s, v) => voice(s, { expression: v }),
  },
  {
    id: "voice.rhythm",
    range: VOICE_RANGE.rhythm,
    default: D.assistant.voice.rhythm,
    read: (s) => s.assistant.voice.rhythm,
    write: (s, v) => voice(s, { rhythm: v }),
  },
  {
    id: "voice.pause",
    range: VOICE_RANGE.pause,
    default: D.assistant.voice.pause,
    read: (s) => s.assistant.voice.pause,
    write: (s, v) => voice(s, { pause: v }),
  },
];

type Said = Readonly<{ vi: readonly string[]; en: readonly string[]; unit?: Readonly<{ vi: string; en: string }> }>;

/** What a person calls a control, in each language: `src/shared/voice-controls.json`. */
const said = (id: string): Said => (names as unknown as Record<string, Said>)[id] ?? { vi: [], en: [] };

const ui = () => useSharedUiStore.getState();

/**
 * Everything a spoken line may work: the menu's sliders and switches, the
 * language, and which entry the menu is on. Not the assistant's own on/off
 * switch: turning it off by voice would leave nobody to turn it back on.
 */
export const createVoiceControls = (deps: ControlDeps) => {
  const toggles: readonly ToggleEntry[] = [
    {
      id: "menu",
      read: () => ui().menuOpen,
      write: (on) => ui().setMenuOpen(on),
    },
    {
      id: "diagnostics",
      read: () => ui().diagnosticsOpen,
      write: (on) => ui().setDiagnosticsOpen(on),
    },
    {
      id: "stereo",
      read: deps.stereoOn,
      write: deps.setStereo,
    },
    {
      id: "autoRotate",
      read: () => deps.settings().view.autoRotate,
      write: (on) => deps.apply({ ...deps.settings(), view: { ...deps.settings().view, autoRotate: on } }),
    },
    {
      id: "snap",
      read: () => deps.settings().flags.snapGesture,
      write: (on) => deps.apply({ ...deps.settings(), flags: { ...deps.settings().flags, snapGesture: on } }),
    },
    {
      id: "mirror",
      read: () => deps.settings().render.mirrorFrontCamera,
      write: (on) => deps.apply(render(deps.settings(), { mirrorFrontCamera: on })),
    },
  ];

  /** What is sent to the server with each spoken line. */
  const describe = (): readonly SpokenControl[] => {
    const settings = deps.settings();
    const out: SpokenControl[] = [];
    for (const entry of NUMBERS) {
      out.push({
        id: entry.id,
        kind: "number",
        vi: said(entry.id).vi,
        en: said(entry.id).en,
        unit: said(entry.id).unit ?? { vi: "", en: "" },
        ...entry.range,
        value: entry.read(settings),
        default: entry.default,
      });
    }
    for (const entry of toggles) {
      out.push({
        id: entry.id,
        kind: "toggle",
        vi: said(entry.id).vi,
        en: said(entry.id).en,
        value: entry.read(),
        ...(entry.id === "menu" ? { open: true } : {}),
      });
    }
    for (const category of SETTINGS_CATEGORIES) {
      const name = message(`category.${category}`);
      out.push({ id: `page.${category}`, kind: "page", vi: [name.vi], en: [name.en] });
    }
    const language = names.locale;
    out.push({ id: "locale", kind: "choice", vi: language.vi, en: language.en, options: language.options });
    return out;
  };

  /** Does what the server decided. Unknown ids and values out of shape are ignored. */
  const run = (id: string, value: unknown): void => {
    if (id.startsWith("page.")) {
      const category = id.slice(5) as SettingsCategory;
      if (SETTINGS_CATEGORIES.includes(category)) {
        ui().setMenuOpen(true);
        ui().openSettingsCategory(category);
      }
      return;
    }
    if (id === "locale") {
      if (LOCALES.includes(value as Locale)) useLocaleStore.getState().setLocale(value as Locale);
      return;
    }
    const number = NUMBERS.find((candidate) => candidate.id === id);
    if (number && typeof value === "number" && Number.isFinite(value)) {
      const { min, max } = number.range;
      deps.apply(number.write(deps.settings(), Math.min(max, Math.max(min, value))));
      return;
    }
    const toggle = toggles.find((candidate) => candidate.id === id);
    if (toggle && typeof value === "boolean") toggle.write(value);
  };

  return { describe, run };
};
