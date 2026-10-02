export type ModuleBudget = Readonly<{
  /** Hard deadline for one `process()` call, ms. */
  timeoutMs: number;
  /** Failures in a row before the module is parked in the `failed` state. */
  maxConsecutiveFailures: number;
  /** Backoff before an automatic retry after a failure, ms. */
  retryDelayMs: number;
}>;

const DEFAULT_BUDGET: ModuleBudget = {
  timeoutMs: 1500,
  maxConsecutiveFailures: 3,
  retryDelayMs: 4000,
};

/**
 * Per-module resource policy. Timeouts are derived from the module's own
 * requested FPS so a slow module degrades itself instead of the whole runtime.
 */
export const budgetFor = (preferredFps: number, overrides: Partial<ModuleBudget> = {}): ModuleBudget => {
  const frameIntervalMs = 1000 / Math.max(preferredFps, 1);
  return {
    ...DEFAULT_BUDGET,
    timeoutMs: Math.min(Math.max(frameIntervalMs * 3, 400), DEFAULT_BUDGET.timeoutMs),
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
