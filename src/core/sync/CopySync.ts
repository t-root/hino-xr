export class CopySync<V> {
  private readonly copies = new Set<(view: V) => void>();
  private applying = false;
  private current: V;

  constructor(initial: V) {
    this.current = initial;
  }

  get view(): V {
    return this.current;
  }

  register(apply: (view: V) => void): { publish: (view: V) => void; dispose: () => void } {
    const guarded = (view: V) => {
      this.applying = true;
      try {
        apply(view);
      } finally {
        this.applying = false;
      }
    };
    this.copies.add(guarded);
    return {
      publish: (view) => {
        if (this.applying) return;
        this.current = view;
        for (const copy of this.copies) if (copy !== guarded) copy(view);
      },
      dispose: () => {
        this.copies.delete(guarded);
      },
    };
  }

  set(view: V): void {
    this.current = view;
    for (const copy of this.copies) copy(view);
  }
}
