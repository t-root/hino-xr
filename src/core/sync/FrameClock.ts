export type FrameListener = (nowMs: number, deltaMs: number) => void;

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
        console.error(error);
      }
    }
  };
}

export const frameClock = new Clock();
