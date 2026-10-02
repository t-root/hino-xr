/**
 * One state for every copy (rules.md).
 *
 * The interface exists once per eye, and a value kept in one copy is a value
 * the other copy does not have. Whatever decides what is on screen lives in a
 * `SharedState`; each copy subscribes and draws from it, and a copy that is
 * clicked writes here rather than into itself, so both redraw in the same task.
 * Core's own panels use `SharedUiStore` for the same reason; this is the same
 * idea for a plugin's screen, without a dependency on Core's store shape.
 */
export class SharedState<T extends object> {
  private value: T;
  private readonly listeners = new Set<(value: T) => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  /** Merges `patch` and redraws every copy, in subscription order. */
  set(patch: Partial<T>): void {
    this.value = { ...this.value, ...patch };
    this.notify();
  }

  /** Redraws every copy without changing anything (e.g. the language moved). */
  notify(): void {
    for (const listener of [...this.listeners]) listener(this.value);
  }

  /** Draws now and on every change; returns how to stop. */
  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    listener(this.value);
    return () => this.listeners.delete(listener);
  }
}
