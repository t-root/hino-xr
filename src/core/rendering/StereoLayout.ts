import type { LocalizedText } from "@/shared/contracts/locale";

export type StereoMode = "stereo" | "mono";

type EyeId = "left" | "right" | "center";

export type EyeRect = Readonly<{
  id: EyeId;
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type StereoState = Readonly<{
  eyes: readonly EyeRect[];
  mode: StereoMode;
  requestedMode: StereoMode;
  monoReasons: readonly LocalizedText[];
}>;

type StereoStateListener = (state: StereoState) => void;

const packFullFrame = (width: number, height: number): EyeRect => ({
  id: "center",
  x: 0,
  y: 0,
  width,
  height,
});

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

  get state(): StereoState {
    return this.snapshot;
  }

  get eyes(): readonly EyeRect[] {
    return this.snapshot.eyes;
  }

  get currentMode(): StereoMode {
    return this.snapshot.mode;
  }

  get requestedMode(): StereoMode {
    return this.snapshot.requestedMode;
  }

  get eyeAspect(): number {
    const eye = this.snapshot.eyes[0] as EyeRect;
    return eye.width / eye.height;
  }

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

  requireMono(reason: LocalizedText): () => void {
    const id = this.nextLockId++;
    this.locks.set(id, reason);
    this.update();
    return () => {
      if (!this.locks.delete(id)) return;
      this.update();
    };
  }

  setGap(gapPx: number): void {
    const next = Math.max(Math.round(gapPx), 0);
    if (this.gap === next) return;
    this.gap = next;
    this.update();
  }

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
