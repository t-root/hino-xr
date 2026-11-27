import type { HandFrame } from "@/shared/contracts/input";
import type { SnapSettings } from "../state/settings";

export type SnapState = "ready" | "loaded" | "cooldown";

export type SnapFeatures = Readonly<{
  thumbMiddle: number;
  thumbIndex: number;
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
  busy: boolean;
}>;

const LOAD_TM = 0.5;
const MIN_REACH = 1.1;
const NOT_A_PINCH = 1.25;
const LOAD_HOLD_MS = 0;
const RELEASE_TM = 0.5;
const FOLD = 0.15;
const OPEN_SPEED = 1;
const WINDOW_MS = 500;
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

  progress(): number {
    return this.state === "loaded" ? 0.5 : 0;
  }

  update(tick: SnapTick): boolean {
    const { nowMs, features } = tick;
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
