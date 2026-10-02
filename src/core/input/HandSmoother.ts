import type { HandFrame, HandPointer, Handedness } from "@/shared/contracts/input";
import { OneEuroFilter } from "@/shared/math/one-euro";
import { extractSignals } from "./GestureRecognizer";
import type { GestureSettings } from "../state/settings";

/**
 * Turns noisy per-frame landmarks into a stable pointer. It also enforces the
 * warm-up rule: a hand must be confidently tracked for a couple of frames
 * before it can drive the UI, which prevents flicker-induced clicks.
 */
export class HandSmoother {
  private readonly x = new OneEuroFilter();
  private readonly y = new OneEuroFilter();
  private readonly z = new OneEuroFilter({ minCutoff: 0.8, beta: 0.01, derivativeCutoff: 1 });
  /**
   * The pinch is filtered to follow, not to settle.
   *
   * A position may lag a little and no one minds — the cursor merely trails the
   * pinch. The pinch is read against a threshold, so lag there is lag on the
   * press itself: a gentle low-pass took about eight frames to fall from open to
   * closed, and a quick pinch was over before the number said it had begun.
   * Hence a high `beta`, which lets the filter all but stand aside while the
   * fingers are moving and smooth again once they have stopped. Noise is not the
   * filter's job here; the hysteresis and the hold times below do that.
   */
  private readonly pinch = new OneEuroFilter({ minCutoff: 8, beta: 3, derivativeCutoff: 4 });
  private confidentFrames = 0;

  constructor(
    private readonly hand: Handedness,
    private settings: GestureSettings,
  ) {}

  setSettings(settings: GestureSettings): void {
    this.settings = settings;
  }

  update(frame: HandFrame): HandPointer | null {
    if (frame.confidence < this.settings.trackingConfidence) {
      this.confidentFrames = 0;
      return null;
    }
    this.confidentFrames += 1;
    if (this.confidentFrames < this.settings.trackingWarmupFrames) return null;

    const signals = extractSignals(frame);
    const x = this.x.filter(signals.pinchPoint.x, frame.timestampMs);
    const y = this.y.filter(signals.pinchPoint.y, frame.timestampMs);
    const z = this.z.filter(signals.pinchPoint.z, frame.timestampMs);
    const pinchStrength = this.pinch.filter(signals.pinchRatio, frame.timestampMs);

    return {
      hand: this.hand,
      position: { x, y, z },
      velocity: { x: this.x.speedPerSecond, y: this.y.speedPerSecond },
      pinchStrength,
      pinchVelocity: this.pinch.speedPerSecond,
      thumbMiddleRatio: signals.thumbMiddleRatio,
      middleCurlRatio: signals.middleCurlRatio,
      snapPress: signals.snapPress,
      confidence: frame.confidence,
      timestampMs: frame.timestampMs,
    };
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
    this.z.reset();
    this.pinch.reset();
    this.confidentFrames = 0;
  }
}
