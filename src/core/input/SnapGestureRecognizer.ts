import type { SnapSettings } from "../state/settings";

export type SnapState = "ready" | "cooldown";

type SnapTick = Readonly<{
  nowMs: number;
  /** Thumb-to-middle-finger distance divided by hand size. The landing pose has them together. */
  thumbMiddleRatio: number;
  /** Middle fingertip to palm centre, over hand size. Small once folded in. */
  middleCurlRatio: number;
  /** True while the hand is pinching, dragging or grabbing something. */
  busy: boolean;
}>;

/**
 * Finger snap, decided by the landing alone.
 *
 * The press (thumb against middle finger) and the flick (the gap jumping open) are not asked for: the tracker
 * cannot see them reliably at ~24 fps and every pose that looked a little like them fired the menu. What cannot
 * be faked by a loose hand is the end of the movement: the middle fingertip arriving on the palm, from a place
 * clearly further away, within a short time. That is the snap.
 *
 * Fires on the tick the middle fingertip is below `palmRatio` of hand size AND is at least `CURL_DROP` closer
 * to the palm than it was at its furthest within the last `windowMs`. A hand that simply stays closed has no
 * such drop and never fires; a fist is not a landing either (`FIST_CURL`), since a snap ends on the palm with the
 * finger, not with the whole hand clenched.
 */

/** How much closer to the palm the middle fingertip must get, from its furthest in the window, to count as landing. */
const CURL_DROP = 0.2;

/** Below this the whole hand is a fist, not a finger landing on the palm. */
const FIST_CURL = 0.4;

/**
 * The landing pose: thumb and middle finger come to rest together on the palm (thumb laid across, middle finger
 * folded against it). Thumb tip to middle tip, over hand size, must be below this. Loose on purpose: the tracker
 * rarely reports the two tips exactly touching, but a hand with the middle finger away from the thumb is not it.
 */
const LANDED_GAP = 0.8;

/**
 * The middle fingertip must be ON the palm, not merely folded toward it. An open hand with the thumb touching a
 * bent finger (the "OK"-like pose) has the tip about one hand-length from the palm centre; a real landing sits well
 * inside that. Capped here as well as in `palmRatio` because a saved `palmRatio` from older settings would keep the
 * loose value.
 */
const LANDED_CURL = 0.85;

/** A snap lands fast; a hand that is merely closing or moving takes longer. The drop must happen inside this. */
const DROP_WITHIN_MS = 320;

/** Before the drop the middle finger must have been really away from the palm, not just moving between folded poses. */
const WAS_EXTENDED = 0.7;

/** The landing must still be seen on this many consecutive tracker frames: a one-frame jitter of the tip is not it. */
const LANDED_FRAMES = 1;

export class SnapGestureRecognizer {
  private state: SnapState = "ready";
  private stateSinceMs = 0;
  /** Recent middle-finger distances to the palm, oldest first. */
  private history: { nowMs: number; curl: number }[] = [];
  private landedFrames = 0;

  constructor(private settings: SnapSettings) {}

  setSettings(settings: SnapSettings): void {
    this.settings = settings;
  }

  get currentState(): SnapState {
    return this.state;
  }

  /** Returns true on the frame a snap completes. */
  update(tick: SnapTick): boolean {
    // A hand in the middle of holding something is not snapping, whatever the fingers look like.
    if (tick.busy) {
      this.history = [];
      this.landedFrames = 0;
      return false;
    }

    if (this.state === "cooldown") {
      if (tick.nowMs - this.stateSinceMs >= this.settings.cooldownMs) this.transition("ready", tick.nowMs);
      return false;
    }

    this.history.push({ nowMs: tick.nowMs, curl: tick.middleCurlRatio });
    while (this.history.length > 0 && tick.nowMs - (this.history[0] as { nowMs: number }).nowMs > DROP_WITHIN_MS) {
      this.history.shift();
    }

    const furthest = this.history.reduce((most, entry) => Math.max(most, entry.curl), 0);
    const landed =
      tick.middleCurlRatio < Math.min(this.settings.palmRatio, LANDED_CURL) &&
      tick.middleCurlRatio >= FIST_CURL &&
      tick.thumbMiddleRatio < LANDED_GAP &&
      furthest >= WAS_EXTENDED &&
      furthest - tick.middleCurlRatio >= CURL_DROP;
    this.landedFrames = landed ? this.landedFrames + 1 : 0;
    if (this.landedFrames < LANDED_FRAMES) return false;
    this.landedFrames = 0;

    this.history = [];
    this.transition("cooldown", tick.nowMs);
    return true;
  }

  reset(): void {
    this.state = "ready";
    this.history = [];
    this.landedFrames = 0;
  }

  private transition(state: SnapState, nowMs: number): void {
    this.state = state;
    this.stateSinceMs = nowMs;
  }
}
