/**
 * Bends the interface drawn on `.camera-frame` (menu, text, cursor-sized controls) the same way the
 * camera picture is bent, so a lens does not straighten the video and leave the menu flat and square.
 *
 * `VideoLayer` samples the camera at `0.5 + (uv - 0.5) * factor / fit`. This does the same to the DOM
 * with an SVG displacement filter, built from the same formula, so a hand that points at a spot in the
 * camera picture lands on the control drawn there: the hit-test needs no correction of its own.
 *
 * Off (no filter at all) while k1 and k2 are both 0, so a flat view costs nothing.
 */

const FILTER_ID = "hino-lens-warp";
const SVG_NS = "http://www.w3.org/2000/svg";
/** The displacement field is smooth, so a coarse grid is enough; the browser interpolates it. */
const GRID = 96;

/** Where the picture is sampled for a point of the frame: both in `0..1` of the square. */
export const warpSource = (u: number, v: number, k1: number, k2: number): { x: number; y: number } => {
  const dx = u - 0.5;
  const dy = v - 0.5;
  const r2 = dx * dx + dy * dy;
  const factor = 1 + k1 * r2 + k2 * r2 * r2;
  const fit = Math.max(1 + k1 * 0.25 + k2 * 0.0625, 1);
  const scale = factor / fit;
  return { x: 0.5 + dx * scale, y: 0.5 + dy * scale };
};

type Field = Readonly<{ url: string; scale: number }>;

/** The displacement map as an image: red and green are the sideways and downward move, 0.5 meaning none. */
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
      // Past the edge the picture clamps to its edge (as `VideoLayer` does) instead of going clear: a
      // clear patch lets the bright camera show through where the dark veil should be.
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

  setLens(k1: number, k2: number): void {
    this.k1 = k1;
    this.k2 = k2;
    this.apply();
  }

  /** Size in px of the camera square. Both eyes share it. */
  setFrameSize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.apply();
  }

  private apply(): void {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const active = (this.k1 !== 0 || this.k2 !== 0) && this.width > 0 && this.height > 0;
    if (!active) {
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
    // sRGB, or the browser reads the map as linear light and every move comes out wrong.
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
