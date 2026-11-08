export type ModuleBudget = Readonly<{
  /** Hard deadline for one `process()` call, ms. */
  timeoutMs: number;
  /** Failures in a row before the module is parked in the `failed` state. */
  maxConsecutiveFailures: number;
  /** Backoff before an automatic retry after a failure, ms. */
  retryDelayMs: number;
}>;

const DEFAULT_BUDGET: ModuleBudget = {
  timeoutMs: 4000,
  maxConsecutiveFailures: 5,
  retryDelayMs: 4000,
};

/**
 * How long one frame may take, in frame intervals, and the least and most that allows (ms).
 *
 * A frame is only given to a module that is free (`FrameHub` skips a busy one), so waiting longer never builds a
 * backlog: it only decides when a module counts as hung. Several workers share one machine with hand tracking, the
 * camera and the speech models, and a model that takes half a second on a quiet machine takes two when they all
 * run; that must slow it down, not switch it off.
 */
const FRAMES_ALLOWED = 8;
const FLOOR_MS = 2500;

/**
 * Per-module resource policy. Timeouts are derived from the module's own
 * requested FPS so a slow module degrades itself instead of the whole runtime.
 */
export const budgetFor = (preferredFps: number, overrides: Partial<ModuleBudget> = {}): ModuleBudget => {
  const frameIntervalMs = 1000 / Math.max(preferredFps, 1);
  return {
    ...DEFAULT_BUDGET,
    timeoutMs: Math.min(Math.max(frameIntervalMs * FRAMES_ALLOWED, FLOOR_MS), DEFAULT_BUDGET.timeoutMs),
    ...overrides,
  };
};

export const withTimeout = async <T>(
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<T> => {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }
};
