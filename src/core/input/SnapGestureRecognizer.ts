import type { SnapSettings } from "../state/settings";

export type SnapState = "ready" | "contact" | "flick" | "cooldown";

type SnapTick = Readonly<{
  nowMs: number;
  /** Thumb-to-middle-finger distance divided by hand size. */
  thumbMiddleRatio: number;
  /** Middle fingertip to palm centre, over hand size. Small once folded in. */
  middleCurlRatio: number;
  /** True while the hand is pinching, dragging or grabbing something. */
  busy: boolean;
}>;

/**
 * Finger snap: thumb and middle finger, in three phases.
 *
 * A snap is a *movement over time*, not a pose, and that is the whole reason
 * this class exists instead of a threshold somewhere:
 *
 *  1. **press** — thumb and middle fingertip held together, briefly;
 *  2. **flick** — the middle finger leaves the thumb, seen as the gap jumping
 *     open much faster than a hand simply opening;
 *  3. **land** — that same finger arrives closer to the palm than it was
 *     during the press.
 *
 * All three are required. Folding into a fist is not a flick: the gap never
 * opens. Releasing two fingers that were merely close is not a landing: the
 * middle finger never travels toward the palm.
 *
 * The press itself is a bent middle finger against the thumb, so it already
 * looks somewhat folded. That pose must still count; only a fully clenched
 * fist is rejected. Tracking at ~24 fps often skips the frames in between
 * press and palm — a jump from contact to a folded finger in one tick is
 * still the same movement, counted as one, but only when the gap opened.
 */

/** Gap increase in one tick that still counts as a flick when a frame was skipped. */
const GAP_JUMP = 0.25;

/** How much closer to the palm the middle fingertip must get to count as landing. */
const CURL_DROP = 0.15;

/**
 * Below this, the middle fingertip is on the palm: a fist, not a snap press.
 * A real press sits well above this — the tip is on the thumb, not the skin.
 */
const FIST_CURL = 0.55;

export class SnapGestureRecognizer {
  private state: SnapState = "ready";
  private stateSinceMs = 0;
  private contactSinceMs: number | null = null;
  /** Most extended the middle finger was during this press. Landing is a drop from here. */
  private curlAtContact: number | null = null;
  private lastRatio: number | null = null;
  private lastTickMs = 0;

  constructor(private settings: SnapSettings) {}

  setSettings(settings: SnapSettings): void {
    this.settings = settings;
  }

  get currentState(): SnapState {
    return this.state;
  }

  /** Returns true on the frame a snap completes. */
  update(tick: SnapTick): boolean {
    const dtSeconds = this.lastTickMs === 0 ? 1 / 30 : Math.max((tick.nowMs - this.lastTickMs) / 1000, 1e-3);
    const previousGap = this.lastRatio;
    const velocity = previousGap === null ? 0 : (tick.thumbMiddleRatio - previousGap) / dtSeconds;
    this.lastRatio = tick.thumbMiddleRatio;
    this.lastTickMs = tick.nowMs;

    // A hand in the middle of holding something is not snapping, whatever the
    // fingers look like: the same hand cannot be doing both.
    if (tick.busy && this.state !== "cooldown") {
      this.transition("ready", tick.nowMs);
      return false;
    }

    const parted = tick.thumbMiddleRatio > this.settings.releaseRatio;
    const fist = tick.middleCurlRatio < FIST_CURL;
    const landed =
      this.curlAtContact !== null &&
      tick.middleCurlRatio <= this.curlAtContact - CURL_DROP &&
      tick.middleCurlRatio < this.settings.palmRatio;
    const flicked =
      velocity > this.settings.velocityThreshold ||
      (previousGap !== null && tick.thumbMiddleRatio - previousGap > GAP_JUMP);

    switch (this.state) {
      case "ready": {
        const touching = tick.thumbMiddleRatio < this.settings.contactRatio && !fist;
        if (!touching) {
          this.contactSinceMs = null;
          return false;
        }
        this.contactSinceMs ??= tick.nowMs;
        // Held, not brushed past: fingers cross each other constantly while a
        // hand moves, and a single frame of contact means nothing.
        if (tick.nowMs - this.contactSinceMs >= this.settings.contactHoldMs) {
          this.transition("contact", tick.nowMs);
          this.curlAtContact = tick.middleCurlRatio;
        }
        return false;
      }

      case "contact":
        this.curlAtContact = Math.max(this.curlAtContact ?? tick.middleCurlRatio, tick.middleCurlRatio);
        if (flicked) {
          this.transition("flick", tick.nowMs);
          // One tracking frame can be the whole flight when the rate is low.
          if (landed) {
            this.transition("cooldown", tick.nowMs);
            return true;
          }
          return false;
        }
        // A fist forming while the tips are still together is not a snap.
        if (parted || fist) this.transition("ready", tick.nowMs);
        return false;

      case "flick": {
        // The finger has left the thumb; it now has this long to arrive at the
        // palm. Long enough for the tracker to miss a frame of a fast motion,
        // short enough that an unrelated fist later is not read as the ending.
        if (tick.nowMs - this.stateSinceMs > this.settings.windowMs) {
          this.transition("ready", tick.nowMs);
          return false;
        }
        // The flick already proved they separated. Requiring the gap to stay
        // wide as well fights the landing: thumb and middle both end near the
        // palm, so they look close again.
        if (landed) {
          this.transition("cooldown", tick.nowMs);
          return true;
        }
        return false;
      }

      case "cooldown":
        if (tick.nowMs - this.stateSinceMs >= this.settings.cooldownMs) this.transition("ready", tick.nowMs);
        return false;
    }
  }

  reset(): void {
    this.state = "ready";
    this.contactSinceMs = null;
    this.curlAtContact = null;
    this.lastRatio = null;
    this.lastTickMs = 0;
  }

  private transition(state: SnapState, nowMs: number): void {
    this.state = state;
    this.stateSinceMs = nowMs;
    this.contactSinceMs = null;
    if (state === "ready" || state === "cooldown") this.curlAtContact = null;
  }
}
