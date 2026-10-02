type MetricSnapshot = Readonly<{
  counters: Readonly<Record<string, number>>;
  timings: Readonly<Record<string, { p50: number; p95: number; last: number; count: number }>>;
}>;

export interface Metrics {
  count(name: string, value?: number): void;
  timing(name: string, ms: number): void;
  snapshot(): MetricSnapshot;
  reset(): void;
}

const WINDOW = 120;

const percentile = (sorted: readonly number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index] ?? 0;
};

/** In-memory, aggregate-only metrics: no labels, no payloads, no PII. */
export class RuntimeMetrics implements Metrics {
  private readonly counters = new Map<string, number>();
  private readonly samples = new Map<string, number[]>();

  count(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  timing(name: string, ms: number): void {
    let bucket = this.samples.get(name);
    if (!bucket) {
      bucket = [];
      this.samples.set(name, bucket);
    }
    bucket.push(ms);
    if (bucket.length > WINDOW) bucket.shift();
  }

  snapshot(): MetricSnapshot {
    const counters: Record<string, number> = {};
    for (const [key, value] of this.counters) counters[key] = value;

    const timings: Record<string, { p50: number; p95: number; last: number; count: number }> = {};
    for (const [key, bucket] of this.samples) {
      const sorted = [...bucket].sort((a, b) => a - b);
      timings[key] = {
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        last: bucket[bucket.length - 1] ?? 0,
        count: bucket.length,
      };
    }
    return { counters, timings };
  }

  reset(): void {
    this.counters.clear();
    this.samples.clear();
  }
}
