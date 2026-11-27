const FILTER_ID = "hino-lens-warp";
const SVG_NS = "http://www.w3.org/2000/svg";
const GRID = 96;

export const warpSource = (u: number, v: number, k1: number, k2: number): { x: number; y: number } => {
  const dx = u - 0.5;
  const dy = v - 0.5;
  const r2 = dx * dx + dy * dy;
  const factor = 1 + k1 * r2 + k2 * r2 * r2;
  const fit = Math.max(1 + k1 * 0.25 + k2 * 0.0625, 1);
  const scale = factor / fit;
  return { x: 0.5 + dx * scale, y: 0.5 + dy * scale };
};

export const warpTarget = (x: number, y: number, k1: number, k2: number): { x: number; y: number } => {
  if (k1 === 0 && k2 === 0) return { x, y };
  const dx = x - 0.5;
  const dy = y - 0.5;
  const rho = Math.hypot(dx, dy);
  if (rho === 0) return { x, y };
  const fit = Math.max(1 + k1 * 0.25 + k2 * 0.0625, 1);
  const sourceRadius = (r: number): number => (r * (1 + k1 * r * r + k2 * r * r * r * r)) / fit;
  let low = 0;
  let high = 4;
  for (let step = 0; step < 40; step += 1) {
    const mid = (low + high) / 2;
    if (sourceRadius(mid) < rho) low = mid;
    else high = mid;
  }
  const r = (low + high) / 2;
  return { x: 0.5 + (dx / rho) * r, y: 0.5 + (dy / rho) * r };
};

type Field = Readonly<{ url: string; scale: number }>;

const buildField = (k1: number, k2: number, width: number, height: number): Field | null => {
  const canvas = document.createElement("canvas");
  canvas.width = GRID;
  canvas.height = GRID;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const moves: number[] = [];
  let largest = 0;
  for (let row = 0; row < GRID; row += 1) {
    for (let column = 0; column < GRID; column += 1) {
      const u = column / (GRID - 1);
      const v = row / (GRID - 1);
      const source = warpSource(u, v, k1, k2);
      const moveX = (Math.min(Math.max(source.x, 0), 1) - u) * width;
      const moveY = (Math.min(Math.max(source.y, 0), 1) - v) * height;
      moves.push(moveX, moveY);
      largest = Math.max(largest, Math.abs(moveX), Math.abs(moveY));
    }
  }
  const scale = Math.max(largest * 2, 1);
  const image = context.createImageData(GRID, GRID);
  for (let index = 0; index < GRID * GRID; index += 1) {
    image.data[index * 4] = Math.round((0.5 + (moves[index * 2] as number) / scale) * 255);
    image.data[index * 4 + 1] = Math.round((0.5 + (moves[index * 2 + 1] as number) / scale) * 255);
    image.data[index * 4 + 2] = 128;
    image.data[index * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return { url: canvas.toDataURL("image/png"), scale };
};

class LensWarp {
  private k1 = 0;
  private k2 = 0;
  private width = 0;
  private height = 0;
  private svg: SVGSVGElement | null = null;
  private lastKey = "";

  seen(x: number, y: number): { x: number; y: number } {
    return this.active() ? warpTarget(x, y, this.k1, this.k2) : { x, y };
  }

  private active(): boolean {
    return (this.k1 !== 0 || this.k2 !== 0) && this.width > 0 && this.height > 0;
  }

  setLens(k1: number, k2: number): void {
    this.k1 = k1;
    this.k2 = k2;
    this.apply();
  }

  setFrameSize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.apply();
  }

  private apply(): void {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (!this.active()) {
      delete root.dataset.lensWarp;
      return;
    }
    const key = `${this.k1}|${this.k2}|${Math.round(this.width)}|${Math.round(this.height)}`;
    if (key !== this.lastKey) {
      const field = buildField(this.k1, this.k2, this.width, this.height);
      if (!field) {
        delete root.dataset.lensWarp;
        return;
      }
      this.lastKey = key;
      this.paint(field);
    }
    root.dataset.lensWarp = "on";
  }

  private paint(field: Field): void {
    if (!this.svg) {
      this.svg = document.createElementNS(SVG_NS, "svg");
      this.svg.setAttribute("width", "0");
      this.svg.setAttribute("height", "0");
      this.svg.setAttribute("aria-hidden", "true");
      this.svg.style.position = "absolute";
      document.body.append(this.svg);
    }
    const w = String(this.width);
    const h = String(this.height);
    this.svg.innerHTML = `
      <filter id="${FILTER_ID}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse"
              x="0" y="0" width="${w}" height="${h}" color-interpolation-filters="sRGB">
        <feImage href="${field.url}" x="0" y="0" width="${w}" height="${h}"
                 preserveAspectRatio="none" result="field"/>
        <feDisplacementMap in="SourceGraphic" in2="field" scale="${field.scale}"
                           xChannelSelector="R" yChannelSelector="G"/>
      </filter>`;
  }
}

export const lensWarp = new LensWarp();
