export type ConsumerTiming = {
  readonly id: string;
  readonly preferredFps: number;
  lastDispatchMs: number;
  busy: boolean;
};

type SchedulerLoad = Readonly<{
  /** Measured render FPS; drives adaptive downscaling of analysis rate. */
  renderFps: number;
  /** False when the tab is hidden: analysis pauses entirely. */
  visible: boolean;
}>;

const TARGET_RENDER_FPS = 30;

/**
 * Decides which consumers receive the current frame. Rendering always wins:
 * when render FPS drops the analysis quota shrinks proportionally instead of
 * letting inference steal frame time.
 */
export class FrameScheduler {
  private load: SchedulerLoad = { renderFps: TARGET_RENDER_FPS, visible: true };

  setLoad(load: SchedulerLoad): void {
    this.load = load;
  }

  /** 1 at healthy render FPS, down to 0.25 when the renderer is struggling. */
  get adaptiveScale(): number {
    if (!this.load.visible) return 0;
    const ratio = this.load.renderFps / TARGET_RENDER_FPS;
    if (ratio >= 0.95) return 1;
    if (ratio >= 0.8) return 0.75;
    if (ratio >= 0.6) return 0.5;
    return 0.25;
  }

  shouldDispatch(consumer: ConsumerTiming, nowMs: number): boolean {
    if (consumer.busy) return false;
    const scale = this.adaptiveScale;
    if (scale === 0) return false;
    const effectiveFps = Math.max(consumer.preferredFps * scale, 1);
    return nowMs - consumer.lastDispatchMs >= 1000 / effectiveFps;
  }
}
