import { isTurn, type Turn } from "../view/orientation";
import { DEFAULT_THEME, isHexColor, type ThemeSettings } from "@/ui/theme";
import { clamp, clamp01 } from "@/shared/math/num";

export type GestureSettings = Readonly<{
  /** Minimum landmark confidence for a hand to drive a pointer. */
  trackingConfidence: number;
  /** Frames a hand must stay confident before it produces a pointer. */
  trackingWarmupFrames: number;
  /** Hover dwell before `hover` is emitted, ms. */
  hoverDwellMs: number;
  /** Pinch enters below this ratio of hand size and releases above the hysteresis value. */
  pinchEnterRatio: number;
  pinchExitRatio: number;
  /**
   * How much the gap must grow from the tightest point of this pinch to count
   * as letting go, as a share of hand size.
   *
   * A click opens the fingers a little, not to a stretched pose. The absolute
   * exit ratio is a backstop for a pinch that was never very tight; this is
   * what makes a normal release actually release.
   */
  pinchOpenDelta: number;
  pinchEnterHoldMs: number;
  pinchExitHoldMs: number;
  /** Movement in normalised viewport units that promotes a pinch into a drag. */
  dragThreshold: number;
  /** Time a pinch may be held before it becomes a drag on its own, ms. */
  dragHoldMs: number;
  /** Time without landmarks before an in-flight interaction is cancelled, ms. */
  lostTimeoutMs: number;
  /** Multiplies every distance threshold; exposed as a sensitivity slider. */
  sensitivity: number;
}>;

/** The three phases of a snap, as numbers. */
export type SnapSettings = Readonly<{
  /** Thumb and middle fingertip count as touching below this ratio. */
  contactRatio: number;
  /** How long they must stay touching before it counts as a press, ms. */
  contactHoldMs: number;
  /** Ratio above which the two fingers count as parted. */
  releaseRatio: number;
  velocityThreshold: number;
  /** Middle fingertip counts as landed on the palm below this ratio. */
  palmRatio: number;
  windowMs: number;
  cooldownMs: number;
}>;

export type RenderSettings = Readonly<{
  /** Interpupillary separation of the two virtual eyes, metres. */
  ipdMeters: number;
  /** Distance of the video plane from the viewer, metres. */
  videoPlaneDistance: number;
  /** Distance of the UI/overlay plane, metres. Closer than the video plane. */
  uiPlaneDistance: number;
  /** Detection batches older than this are hidden instead of drawn misaligned. */
  maxBatchAgeMs: number;
  showDiagnostics: boolean;
  mirrorFrontCamera: boolean;
}>;

/**
 * Optics of the headset the phone is sitting in.
 *
 * Every value applies to both eyes at once — the only asymmetry allowed is the
 * lens centre, which is mirrored rather than set per eye, so the two views stay
 * identical to each other (rules.md).
 */
export type LensSettings = Readonly<{
  /** Vertical field of view of one eye, degrees. */
  fovYDeg: number;
  /** Black band between the two eye images, px. Matches the headset divider. */
  eyeGapPx: number;
  /** Optical centre of each eye, as a fraction of eye width from its middle.
   *  Positive pushes the centres apart, for lenses spaced wider than the eyes. */
  lensCenterOffset: number;
  /** Barrel pre-distortion cancelling the pincushion a magnifier introduces. */
  k1: number;
  /** Fourth-order term, for lenses the quadratic term alone cannot straighten. */
  k2: number;
  /** Size of the square camera frame. 1 is the largest square in the eye; not an image zoom. */
  frameScale: number;
}>;

type PipelineSettings = Readonly<{
  handTrackingFps: number;
  moduleFps: number;
  /** Longest edge of the analysis image handed to modules. */
  analysisMaxSize: number;
}>;

type AssistantSettings = Readonly<{
  /** When on, the assistant loads and greets as soon as the wearer presses Start. */
  enabled: boolean;
  /** Catalog slot id, e.g. `qwen-2.5-3b`. */
  modelId: string;
}>;

type FeatureFlags = Readonly<{
  /** Snap opens the menu. On by default now that landing on the palm is
   *  required as well, which is what used to make it fire by accident. */
  snapGesture: boolean;
  webxr: boolean;
  handTracking: boolean;
}>;

/**
 * The hand cursor's own settings.
 *
 * Opacity and size are the user's because the right values depend on what is
 * behind the reticle and how far the hand sits from the camera: a cursor
 * readable against a dark room hides half a face in a bright one, and only the
 * person wearing the headset can see which they have.
 */
type CursorSettings = Readonly<{
  /** Multiplies every part of the cursor; 0 hides it, 1 draws it in full. */
  opacity: number;
  /** Multiplies the drawn size; 1 is the default reticle. */
  scale: number;
}>;

type ViewSettings = Readonly<{
  /**
   * Quarter-turn applied to the interface inside each eye.
   *
   * The stage always splits the long side into two squares. This is only how
   * the picture sits inside those squares. The camera image does not follow.
   */
  rotation: Turn;
  /**
   * When on, gravity from the phone's sensors chooses the quarter-turn so the
   * interface stays upright in the headset. The saved `rotation` is the fallback
   * when the sensors are silent, and the value a tap of 90° writes when the
   * wearer takes over by hand.
   */
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

/**
 * Neutral optics: a flat side-by-side view with no warping, which is what a
 * screen viewed without a headset needs. Dialling these in is the user's job
 * because it depends on their headset, not on the app.
 */
export const DEFAULT_LENS: LensSettings = {
  fovYDeg: 62,
  eyeGapPx: 0,
  lensCenterOffset: 0,
  k1: 0,
  k2: 0,
  frameScale: 1,
};

export const DEFAULT_SETTINGS: Settings = {
  gesture: {
    trackingConfidence: 0.7,
    trackingWarmupFrames: 2,
    hoverDwellMs: 80,
    // MediaPipe never reports bone tips as touching: a pinch that looks closed
    // still sits around a third of the knuckle span. 0.22 was bone-on-bone and
    // the wearer had to crush their fingers together. 0.4 is "clearly closing".
    pinchEnterRatio: 0.4,
    pinchExitRatio: 0.55,
    pinchOpenDelta: 0.08,
    pinchEnterHoldMs: 16,
    pinchExitHoldMs: 24,
    // A hand held up in the air is never still, and as the thumb arrives to
    // meet the index the two tips each move. The cursor sits at their midpoint,
    // so that closing motion largely cancels; what is left is tremor. At one
    // per cent of the view every press still travelled far enough to count as a
    // drag, and a drag is not a click — so nothing opened. This is roughly a
    // fingertip's width on screen: wide enough to absorb a tremor, short enough
    // that meaning to move reads as moving.
    dragThreshold: 0.05,
    // Long enough that a deliberate tap is still a tap when the hand is slow,
    // short enough that waiting for a drag does not feel like waiting.
    dragHoldMs: 500,
    lostTimeoutMs: 150,
    sensitivity: 1,
  },
  snap: {
    contactRatio: 0.45,
    contactHoldMs: 40,
    releaseRatio: 0.7,
    // Ratio units per second. A deliberate snap separates in ~30 ms. Tracking
    // at 24 fps often samples that as one jump, so this is below "one frame
    // from pressed to open" rather than a studio-camera 60 fps slope.
    velocityThreshold: 5,
    // Extended, the middle fingertip sits about 1.8 hand-lengths from the palm
    // centre; folded in, well under one. The line between goes here, with room
    // for a tracker that never quite reports the finger on the skin.
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
    modelId: "qwen-2.5-3b",
  },
};

const STORAGE_KEY = "vr-core.settings.v1";

/**
 * 250 ms was the old default for `maxBatchAgeMs`, saved with everything else
 * although nothing in the menu sets it. On a phone running a detector on its
 * CPU, a result is often older than that by the time it lands, and every box
 * was thrown away; a saved 250 is read as "never chosen" and moved to today's.
 */
const migrateRender = (render: RenderSettings): RenderSettings =>
  render.maxBatchAgeMs === 250 ? { ...render, maxBatchAgeMs: DEFAULT_SETTINGS.render.maxBatchAgeMs } : render;

export const loadSettings = (): Settings => {
  if (typeof localStorage === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const gestureIn = parsed.gesture ?? {};
    const gesture = { ...DEFAULT_SETTINGS.gesture, ...gestureIn };
    // Older sessions saved 0.35 / 0.55 and had no `pinchOpenDelta`. Those
    // numbers are the bug this field exists to fix, and they were never on a
    // slider, so nobody chose them. Taking the new defaults is not resetting a
    // preference; it is applying the correction.
    if (!("pinchOpenDelta" in gestureIn)) {
      gesture.pinchEnterRatio = DEFAULT_SETTINGS.gesture.pinchEnterRatio;
      gesture.pinchExitRatio = DEFAULT_SETTINGS.gesture.pinchExitRatio;
      gesture.pinchOpenDelta = DEFAULT_SETTINGS.gesture.pinchOpenDelta;
    }
    // 0.22 / 60 ms was the "crush the fingertips together" pair. Not a slider.
    if (gesture.pinchEnterRatio <= 0.25) {
      gesture.pinchEnterRatio = DEFAULT_SETTINGS.gesture.pinchEnterRatio;
      gesture.pinchExitRatio = DEFAULT_SETTINGS.gesture.pinchExitRatio;
      gesture.pinchOpenDelta = DEFAULT_SETTINGS.gesture.pinchOpenDelta;
      gesture.pinchEnterHoldMs = DEFAULT_SETTINGS.gesture.pinchEnterHoldMs;
      gesture.pinchExitHoldMs = DEFAULT_SETTINGS.gesture.pinchExitHoldMs;
    }
    const snapIn = parsed.snap ?? {};
    const snap = { ...DEFAULT_SETTINGS.snap, ...snapIn };
    // Older saves are the sets that fired on a fist, or the set so strict a
    // real snap never qualified. None of this was on a slider.
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
      assistant: parseAssistant((parsed as { assistant?: unknown }).assistant),
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

const parseAssistant = (raw: unknown): AssistantSettings => {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS.assistant;
  const value = raw as Record<string, unknown>;
  const modelId = typeof value.modelId === "string" ? value.modelId.trim() : "";
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : DEFAULT_SETTINGS.assistant.enabled,
    modelId: modelId.length > 0 ? modelId : DEFAULT_SETTINGS.assistant.modelId,
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
  } catch {
    // Storage may be unavailable in private mode; settings stay session-only.
  }
};
