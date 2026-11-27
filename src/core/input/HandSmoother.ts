import type { HandFrame, HandPointer, Handedness } from "@/shared/contracts/input";
import { OneEuroFilter } from "@/shared/math/one-euro";
import { extractSignals } from "./GestureRecognizer";
import type { GestureSettings } from "../state/settings";

export class HandSmoother {
  private readonly x = new OneEuroFilter({ minCutoff: 3, beta: 40, derivativeCutoff: 4 });
  private readonly y = new OneEuroFilter({ minCutoff: 3, beta: 40, derivativeCutoff: 4 });
  private readonly z = new OneEuroFilter({ minCutoff: 0.8, beta: 0.01, derivativeCutoff: 1 });
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
