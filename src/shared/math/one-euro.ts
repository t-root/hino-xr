/**
 * 1€ filter (Casiez et al.). Chosen over a fixed low-pass because hand landmarks
 * need aggressive jitter removal while holding still but almost no lag during
 * fast pointer motion.
 */
type OneEuroOptions = Readonly<{
  /** Cutoff at zero speed, Hz. Lower removes more jitter but adds lag. */
  minCutoff: number;
  /** Speed coefficient: higher reacts faster to quick movement. */
  beta: number;
  /** Cutoff of the derivative filter, Hz. */
  derivativeCutoff: number;
}>;

const DEFAULT_ONE_EURO: OneEuroOptions = {
  minCutoff: 1.2,
  beta: 0.02,
  derivativeCutoff: 1,
};

const alpha = (cutoff: number, dtSeconds: number): number => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dtSeconds);
};

class LowPass {
  private value: number | null = null;

  filter(x: number, a: number): number {
    this.value = this.value === null ? x : a * x + (1 - a) * this.value;
    return this.value;
  }

  get last(): number | null {
    return this.value;
  }

  reset(): void {
    this.value = null;
  }
}

export class OneEuroFilter {
  private readonly value = new LowPass();
  private readonly derivative = new LowPass();
  private lastTimestampMs: number | null = null;
  private speed = 0;

  constructor(private readonly options: OneEuroOptions = DEFAULT_ONE_EURO) {}

  /** Returns the filtered value; `speedPerSecond` exposes the smoothed derivative. */
  filter(x: number, timestampMs: number): number {
    const previous = this.value.last;
    const dtSeconds =
      this.lastTimestampMs === null ? 1 / 60 : Math.max((timestampMs - this.lastTimestampMs) / 1000, 1e-4);
    this.lastTimestampMs = timestampMs;

    const rawDerivative = previous === null ? 0 : (x - previous) / dtSeconds;
    this.speed = this.derivative.filter(rawDerivative, alpha(this.options.derivativeCutoff, dtSeconds));

    const cutoff = this.options.minCutoff + this.options.beta * Math.abs(this.speed);
    return this.value.filter(x, alpha(cutoff, dtSeconds));
  }

  get speedPerSecond(): number {
    return this.speed;
  }

  reset(): void {
    this.value.reset();
    this.derivative.reset();
    this.lastTimestampMs = null;
    this.speed = 0;
  }
}
