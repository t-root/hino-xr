export type ModuleBudget = Readonly<{
  timeoutMs: number;
  maxConsecutiveFailures: number;
  retryDelayMs: number;
}>;

const DEFAULT_BUDGET: ModuleBudget = {
  timeoutMs: 4000,
  maxConsecutiveFailures: 5,
  retryDelayMs: 4000,
};

const FRAMES_ALLOWED = 8;
const FLOOR_MS = 2500;

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
