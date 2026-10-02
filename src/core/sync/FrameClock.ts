export type FrameListener = (nowMs: number, deltaMs: number) => void;

/**
 * One clock for everything drawn per eye.
 *
 * Two `requestAnimationFrame` loops are two clocks: they run in an order nobody
 * chose and can land either side of a frame. Anything that animates a copy of
 * the interface — or renders the one source that `CanvasMirror` copies — asks
 * this loop instead, so every listener runs in the same frame, in the order it
 * subscribed. The loop only runs while someone is listening.
 */
class Clock {
  private readonly listeners = new Set<FrameListener>();
  private handle = 0;
  private lastMs = 0;

  onFrame(listener: FrameListener): () => void {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      this.lastMs = performance.now();
      this.handle = requestAnimationFrame(this.tick);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) cancelAnimationFrame(this.handle);
    };
  }

  private readonly tick = (nowMs: number): void => {
    this.handle = requestAnimationFrame(this.tick);
    const deltaMs = nowMs - this.lastMs;
    this.lastMs = nowMs;
    for (const listener of [...this.listeners]) {
      try {
        listener(nowMs, deltaMs);
      } catch (error) {
        // One listener failing must not stop the frame for the others.
        console.error(error);
      }
    }
  };
}

export const frameClock = new Clock();
