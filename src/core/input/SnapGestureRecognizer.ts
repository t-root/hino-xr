import type { HandFrame } from "@/shared/contracts/input";
import type { SnapSettings } from "../state/settings";

export type SnapState = "ready" | "loaded" | "cooldown";

/**
 * What the snap is read from, all in hand sizes (wrist to the knuckle of the middle finger), so it does not
 * depend on how far the hand is. Distances are taken with the picture's own proportions (`aspect`), not in the
 * normalised 0..1 of each axis, which stretches a wide picture sideways and made the same pose measure differently
 * whichever way the hand was turned.
 */
export type SnapFeatures = Readonly<{
  /** Thumb tip to middle fingertip. Small while they press together. */
  thumbMiddle: number;
  /** Thumb tip to index fingertip. Small in a pinch, which is never a snap. */
  thumbIndex: number;
  /** Middle fingertip to wrist. About 1.9 with the finger straight, about 1 when folded into the palm. */
  middleWrist: number;
}>;

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_TIP = 12;

export const snapFeatures = (frame: HandFrame): SnapFeatures | null => {
  const points = frame.landmarks;
  const wrist = points[WRIST];
  const thumb = points[THUMB_TIP];
  const index = points[INDEX_TIP];
  const knuckle = points[MIDDLE_MCP];
  const middle = points[MIDDLE_TIP];
  if (!wrist || !thumb || !index || !knuckle || !middle) return null;
  const aspect = frame.aspect && frame.aspect > 0 ? frame.aspect : 1;
  const span = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
    Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const size = span(wrist, knuckle);
  if (size < 1e-4) return null;
  return {
    thumbMiddle: span(thumb, middle) / size,
    thumbIndex: span(thumb, index) / size,
    middleWrist: span(middle, wrist) / size,
  };
};

type SnapTick = Readonly<{
  nowMs: number;
  features: SnapFeatures;
  /** True while the hand is pinching, dragging or grabbing something. */
  busy: boolean;
}>;

/**
 * Finger snap, in the two phases the open-source "Snap Vanish" detector uses (written again here, not copied):
 *
 *  1. **loaded** — the thumb presses the middle fingertip, the middle finger still reaching out (not a fist), and
 *     the thumb is not on the index finger (that is a pinch). Seen on two frames, or held a moment;
 *  2. **released** — within a short window the thumb and middle finger fly apart AND the middle fingertip folds
 *     back toward the palm, and the opening is quick (a pinch that opens slowly is not a snap).
 *
 * A release with no loaded pose before it, a hand opening slowly, and a pinch (or the moment after one) never count.
 * No sound is used.
 */

/** Loaded: thumb tip to middle fingertip at most this, in hand sizes. */
const LOAD_TM = 0.5;
/** Loaded: the middle finger still reaches out, not folded into the palm. */
const MIN_REACH = 1.1;
/** Loaded: the thumb is clearly nearer the middle finger than the index finger (a pinch is the other way). */
const NOT_A_PINCH = 1.25;
/** Loaded: the pose is held this long, ms. One tracker frame at ~16 fps is about 62 ms, so two frames or one slow one. */
const LOAD_HOLD_MS = 0;
/** Released: the thumb and middle finger are at least this far apart. */
const RELEASE_TM = 0.5;
/** Released: the middle fingertip has come this much closer to the wrist than it was when loaded. */
const FOLD = 0.15;
/** Released: the gap must open at least this fast, hand sizes per second. */
const OPEN_SPEED = 1;
/** The release must come within this long of the last loaded frame, ms. */
const WINDOW_MS = 500;
/** After a pinch or drag lets go the fingers are still moving; nothing counts for this long. */
const AFTER_PINCH_MS = 500;

export class SnapGestureRecognizer {
  private state: SnapState = "ready";
  private stateSinceMs = 0;
  private loadingSinceMs: number | null = null;
  private lastLoadedMs = 0;
  private reachWhenLoaded = 0;
  private gapWhenLoaded = 0;
  private quietUntilMs = 0;

  constructor(private settings: SnapSettings) {}

  setSettings(settings: SnapSettings): void {
    this.settings = settings;
  }

  get currentState(): SnapState {
    return this.state;
  }

  /** Half-way once the press is loaded, so the cursor shows the hand is ready to snap. */
  progress(): number {
    return this.state === "loaded" ? 0.5 : 0;
  }

  /** Returns true on the frame a snap completes. */
  update(tick: SnapTick): boolean {
    const { nowMs, features } = tick;
    // A hand in the middle of holding something is not snapping, whatever the fingers look like.
    if (tick.busy) {
      this.quietUntilMs = nowMs + AFTER_PINCH_MS;
      this.toReady(nowMs);
      return false;
    }
    if (this.state === "cooldown") {
      if (nowMs - this.stateSinceMs >= this.settings.cooldownMs) this.toReady(nowMs);
      return false;
    }
    if (nowMs < this.quietUntilMs) return false;

    const loadedPose =
      features.thumbMiddle < LOAD_TM &&
      features.middleWrist >= MIN_REACH &&
      features.thumbIndex >= features.thumbMiddle * NOT_A_PINCH + 0.1;

    if (loadedPose) {
      this.loadingSinceMs ??= nowMs;
      this.lastLoadedMs = nowMs;
      if (this.state === "loaded") {
        this.reachWhenLoaded = Math.max(this.reachWhenLoaded, features.middleWrist);
        this.gapWhenLoaded = Math.min(this.gapWhenLoaded, features.thumbMiddle);
      } else if (nowMs - this.loadingSinceMs >= LOAD_HOLD_MS) {
        this.state = "loaded";
        this.stateSinceMs = nowMs;
        this.reachWhenLoaded = features.middleWrist;
        this.gapWhenLoaded = features.thumbMiddle;
      }
      return false;
    }
    this.loadingSinceMs = null;
    if (this.state !== "loaded") return false;

    const sinceLoaded = nowMs - this.lastLoadedMs;
    if (sinceLoaded > WINDOW_MS) {
      this.toReady(nowMs);
      return false;
    }
    const openedBy = features.thumbMiddle - this.gapWhenLoaded;
    const released =
      features.thumbMiddle >= RELEASE_TM &&
      this.reachWhenLoaded - features.middleWrist >= FOLD &&
      openedBy / Math.max(sinceLoaded / 1000, 1 / 30) >= OPEN_SPEED;
    if (!released) return false;

    this.state = "cooldown";
    this.stateSinceMs = nowMs;
    return true;
  }

  reset(): void {
    this.state = "ready";
    this.loadingSinceMs = null;
  }

  private toReady(nowMs: number): void {
    this.state = "ready";
    this.stateSinceMs = nowMs;
    this.loadingSinceMs = null;
  }
}
