/**
 * Keeps a widget that holds its own view state identical in every copy.
 *
 * Some widgets cannot be drawn from state alone: a map knows where it is
 * panned to, an editor knows its viewport. Each copy of such a widget registers
 * here with how to go to a view. When the wearer moves one copy, it publishes
 * the new view and every other copy is moved to it in the same task, with the
 * echo it would publish back swallowed. The last published view is kept, so a
 * copy that arrives later starts where the others are.
 */
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

  /**
   * Adds a copy. `apply` moves it to a view; the returned `publish` is what it
   * calls when the wearer moved it.
   */
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
        // A copy being moved to match another reports the move too; that is
        // not the wearer, and passing it on would loop.
        if (this.applying) return;
        this.current = view;
        for (const copy of this.copies) if (copy !== guarded) copy(view);
      },
      dispose: () => {
        this.copies.delete(guarded);
      },
    };
  }

  /** Moves every copy to `view`, as if one of them had published it. */
  set(view: V): void {
    this.current = view;
    for (const copy of this.copies) copy(view);
  }
}
