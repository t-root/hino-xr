export type MirrorSource = HTMLCanvasElement | HTMLImageElement | ImageBitmap | OffscreenCanvas;

type Target = { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D | null };

export type MirrorCopy = Readonly<{
  canvas: HTMLCanvasElement;
  detach: () => void;
}>;

const sizeOf = (source: MirrorSource): { width: number; height: number } =>
  source instanceof HTMLImageElement
    ? { width: source.naturalWidth, height: source.naturalHeight }
    : { width: source.width, height: source.height };

export class CanvasMirror {
  private readonly targets = new Set<Target>();
  private source: MirrorSource | null;

  constructor(source: MirrorSource | null = null) {
    this.source = source;
  }

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
