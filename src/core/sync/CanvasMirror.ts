/** Anything `drawImage` can read: a WebGL canvas, a 2D canvas, a decoded image. */
export type MirrorSource = HTMLCanvasElement | HTMLImageElement | ImageBitmap | OffscreenCanvas;

type Target = { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D | null };

export type MirrorCopy = Readonly<{
  /** Goes in one copy of the interface; it shows whatever the source last showed. */
  canvas: HTMLCanvasElement;
  detach: () => void;
}>;

const sizeOf = (source: MirrorSource): { width: number; height: number } =>
  source instanceof HTMLImageElement
    ? { width: source.naturalWidth, height: source.naturalHeight }
    : { width: source.width, height: source.height };

/**
 * Draw once, show in every eye (rules.md), for the DOM.
 *
 * A canvas keeps its own pixels, so two of them drawn separately are two
 * clocks: one eye can show a frame the other has not drawn yet. Content that is
 * painted — a 3D view, a map tile, a chart — is drawn into one source instead,
 * and each copy of the interface holds a plain canvas that this copies the
 * source into, all of them in the same call. The copies are never drawn on by
 * anything else, so they cannot disagree.
 *
 * The scene the headset sees is already drawn once per eye by
 * `StereoRenderer`; this is for plugin screens and panels that live in DOM.
 */
export class CanvasMirror {
  private readonly targets = new Set<Target>();
  private source: MirrorSource | null;

  constructor(source: MirrorSource | null = null) {
    this.source = source;
  }

  /** A canvas for one copy, already showing the current source. */
  attach(): MirrorCopy {
    const canvas = document.createElement("canvas");
    const target: Target = { canvas, context: canvas.getContext("2d") };
    this.targets.add(target);
    this.paint(target);
    return { canvas, detach: () => this.targets.delete(target) };
  }

  setSource(source: MirrorSource | null): void {
    this.source = source;
  }

  /**
   * Copies the source into every copy, now. Call it in the same task that drew
   * the source: a WebGL canvas only keeps its pixels until the frame is shown.
   */
  present(): void {
    for (const target of this.targets) this.paint(target);
  }

  get copies(): number {
    return this.targets.size;
  }

  dispose(): void {
    this.targets.clear();
    this.source = null;
  }

  private paint({ canvas, context }: Target): void {
    const source = this.source;
    if (!source || !context) return;
    const { width, height } = sizeOf(source);
    if (width === 0 || height === 0) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    } else {
      context.clearRect(0, 0, width, height);
    }
    context.drawImage(source, 0, 0);
  }
}
