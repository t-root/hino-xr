export class SharedState<T extends object> {
  private value: T;
  private readonly listeners = new Set<(value: T) => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  set(patch: Partial<T>): void {
    this.value = { ...this.value, ...patch };
    this.notify();
  }

  notify(): void {
    for (const listener of [...this.listeners]) listener(this.value);
  }

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener);
    listener(this.value);
    return () => this.listeners.delete(listener);
  }
}
