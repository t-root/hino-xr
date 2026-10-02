export type Unsubscribe = () => void;

export interface EventBus<E> {
  emit<K extends keyof E>(type: K, payload: E[K]): void;
  on<K extends keyof E>(type: K, listener: (payload: E[K]) => void): Unsubscribe;
  once<K extends keyof E>(type: K, listener: (payload: E[K]) => void): Unsubscribe;
  listenerCount(type: keyof E): number;
  clear(): void;
}

type EventBusOptions = Readonly<{
  /** Guards against listener leaks in long-lived render loops. */
  maxListenersPerType: number;
  onListenerError: (type: string, error: unknown) => void;
  onLeakSuspected: (type: string, count: number) => void;
}>;

const defaultOptions: EventBusOptions = {
  maxListenersPerType: 64,
  onListenerError: (type, error) => console.error(`[event-bus] listener for "${type}" threw`, error),
  onLeakSuspected: (type, count) =>
    console.warn(`[event-bus] "${type}" has ${count} listeners; suspected leak`),
};

/**
 * Synchronous typed bus. A listener throwing never prevents the remaining
 * listeners from running, so one broken module cannot stall the render loop.
 */
export class TypedEventBus<E> implements EventBus<E> {
  private readonly listeners = new Map<keyof E, Set<(payload: never) => void>>();
  private readonly options: EventBusOptions;

  constructor(options: Partial<EventBusOptions> = {}) {
    this.options = { ...defaultOptions, ...options };
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.listeners.get(type);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) {
      try {
        (listener as (value: E[K]) => void)(payload);
      } catch (error) {
        this.options.onListenerError(String(type), error);
      }
    }
  }

  on<K extends keyof E>(type: K, listener: (payload: E[K]) => void): Unsubscribe {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as (payload: never) => void);
    if (set.size > this.options.maxListenersPerType) {
      this.options.onLeakSuspected(String(type), set.size);
    }
    return () => {
      set.delete(listener as (payload: never) => void);
    };
  }

  once<K extends keyof E>(type: K, listener: (payload: E[K]) => void): Unsubscribe {
    const off = this.on(type, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  listenerCount(type: keyof E): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
