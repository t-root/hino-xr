import type { NormalizedRect } from "@/shared/contracts/vision";
import { clamp01 } from "./num";

/** A box as models report it: pixels in the analysis image. */
export type PixelBox = Readonly<{
  originX: number;
  originY: number;
  width: number;
  height: number;
}>;

/**
 * Pixel box to the 0..1 rectangle the detection contract requires.
 *
 * Edges are clamped as a pair rather than each on its own, so a subject running
 * off the frame keeps the part that is actually visible instead of being
 * dragged back inside at its original width. A box left with no area is `null`:
 * the caller drops it rather than publishing a rectangle nothing can be drawn
 * around or picked from.
 */
export const normalizeBox = (
  box: PixelBox,
  imageWidth: number,
  imageHeight: number,
): NormalizedRect | null => {
  if (imageWidth <= 0 || imageHeight <= 0) return null;

  const left = clamp01(box.originX / imageWidth);
  const right = clamp01((box.originX + box.width) / imageWidth);
  const top = clamp01(box.originY / imageHeight);
  const bottom = clamp01((box.originY + box.height) / imageHeight);

  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;

  return { x: left, y: top, width, height };
};
