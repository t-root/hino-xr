import type { LocalizedText } from "@/shared/contracts/locale";

export type StereoMode = "stereo" | "mono";

type EyeId = "left" | "right" | "center";

/** A viewport rectangle in CSS pixels, measured from the top-left of the stage. */
export type EyeRect = Readonly<{
  id: EyeId;
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type StereoState = Readonly<{
  eyes: readonly EyeRect[];
  /** What is actually drawn, after mono locks are applied. */
  mode: StereoMode;
  /** What the user asked for; restored as soon as the last lock is released. */
  requestedMode: StereoMode;
  /** Written reasons the view is pinned to a single frame, for the user to read. */
  monoReasons: readonly LocalizedText[];
}>;

type StereoStateListener = (state: StereoState) => void;

/** One viewport that occupies the whole stage. Used whenever stereo is off. */
const packFullFrame = (width: number, height: number): EyeRect => ({
  id: "center",
  x: 0,
  y: 0,
  width,
  height,
});

/**
 * Two equal squares packed to the centre of the stage. Landscape is
 * left/right; portrait is top/bottom. Leftover black is split on the outer
 * sides so the pictures meet in the middle instead of leaving a centre gap.
 */
const packCenterSquares = (
  width: number,
  height: number,
  gap: number,
): readonly [EyeRect, EyeRect] => {
  const landscape = width >= height;
  const long = landscape ? width : height;
  const short = landscape ? height : width;
  const seam = Math.min(Math.max(gap, 0), Math.max(long - 2, 0));
  const side = Math.max(Math.min(Math.floor((long - seam) / 2), short), 1);
  const used = side * 2 + seam;
  if (landscape) {
    const x0 = Math.floor((width - used) / 2);
    const y0 = Math.floor((height - side) / 2);
    return [
      { id: "left", x: x0, y: y0, width: side, height: side },
      { id: "right", x: x0 + side + seam, y: y0, width: side, height: side },
    ];
  }
  const x0 = Math.floor((width - side) / 2);
  const y0 = Math.floor((height - used) / 2);
  return [
    { id: "left", x: x0, y: y0, width: side, height: side },
    { id: "right", x: x0, y: y0 + side + seam, width: side, height: side },
  ];
};

const sameRects = (a: readonly EyeRect[], b: readonly EyeRect[]): boolean =>
  a.length === b.length &&
  a.every((rect, index) => {
    const other = b[index] as EyeRect;
    return (
      rect.id === other.id &&
      rect.x === other.x &&
      rect.y === other.y &&
      rect.width === other.width &&
      rect.height === other.height
    );
  });

const sameState = (a: StereoState, b: StereoState): boolean =>
  a.mode === b.mode &&
  a.requestedMode === b.requestedMode &&
  a.monoReasons.length === b.monoReasons.length &&
  a.monoReasons.every((reason, index) => reason === b.monoReasons[index]) &&
  sameRects(a.eyes, b.eyes);

/**
 * The single authority on how the stage is divided between eyes (rules.md).
 *
 * Both the GL viewports and the DOM interface read their geometry from here, so
 * the two eyes cannot drift apart: there is only one set of numbers. In stereo
 * the two rectangles are guaranteed to have identical size, which is what makes
 * a duplicated interface land on the same spot in both halves.
 *
 * Content that cannot be duplicated without drifting — a third-party embed whose
 * pixels we are not allowed to read — takes a mono lock instead. While a lock is
 * held there is exactly one viewport, so there is no second copy that could
 * disagree. Sync is then true by construction in both directions (rules.md).
 */
export class StereoLayout {
  private requested: StereoMode;
  private width = 1;
  private height = 1;
  private gap = 0;
  private nextLockId = 1;
  private readonly locks = new Map<number, LocalizedText>();
  private snapshot: StereoState;
  private readonly listeners = new Set<StereoStateListener>();

  constructor(mode: StereoMode = "stereo") {
    this.requested = mode;
    this.snapshot = this.compute();
  }

  /**
   * Stable reference while nothing changes, so subscribers can compare
   * snapshots by identity and skip work.
   */
  get state(): StereoState {
    return this.snapshot;
  }

  get eyes(): readonly EyeRect[] {
    return this.snapshot.eyes;
  }

  /** Effective mode: mono while any lock is held, whatever the user asked for. */
  get currentMode(): StereoMode {
    return this.snapshot.mode;
  }

  get requestedMode(): StereoMode {
    return this.snapshot.requestedMode;
  }

  /** Aspect ratio of one eye; both eyes always share it. */
  get eyeAspect(): number {
    const eye = this.snapshot.eyes[0] as EyeRect;
    return eye.width / eye.height;
  }

  /** Pixel size of the whole stage, both eyes together. */
  get stage(): Readonly<{ width: number; height: number }> {
    return { width: this.width, height: this.height };
  }

  setMode(mode: StereoMode): void {
    if (this.requested === mode) return;
    this.requested = mode;
    this.update();
  }

  setSize(width: number, height: number): void {
    const nextWidth = Math.max(Math.floor(width), 1);
    const nextHeight = Math.max(Math.floor(height), 1);
    if (nextWidth === this.width && nextHeight === this.height) return;
    this.width = nextWidth;
    this.height = nextHeight;
    this.update();
  }

  /**
   * Pins the stage to a single viewport until the returned function is called.
   * The reason is shown to the user, because a view silently dropping one eye
   * would look like a bug.
   */
  requireMono(reason: LocalizedText): () => void {
    const id = this.nextLockId++;
    this.locks.set(id, reason);
    this.update();
    return () => {
      if (!this.locks.delete(id)) return;
      this.update();
    };
  }

  /**
   * Width of the black band between the two eyes, matching the divider in the
   * headset. Taken off both eyes equally, so they keep the same size.
   */
  setGap(gapPx: number): void {
    const next = Math.max(Math.round(gapPx), 0);
    if (this.gap === next) return;
    this.gap = next;
    this.update();
  }

  /** Arrow property: the reference stays stable for DOM subscribers. */
  readonly subscribe = (listener: StereoStateListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private compute(): StereoState {
    const monoReasons = [...this.locks.values()];
    const mode: StereoMode = monoReasons.length > 0 ? "mono" : this.requested;
    return { eyes: this.computeEyes(mode), mode, requestedMode: this.requested, monoReasons };
  }

  private computeEyes(mode: StereoMode): readonly EyeRect[] {
    return mode === "stereo"
      ? packCenterSquares(this.width, this.height, this.gap)
      : [packFullFrame(this.width, this.height)];
  }

  private update(): void {
    const next = this.compute();
    if (sameState(next, this.snapshot)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
  }
}
