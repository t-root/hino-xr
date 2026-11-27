import type { NormalizedRect } from "@/shared/contracts/vision";
import { clamp01 } from "./num";

export type PixelBox = Readonly<{
  originX: number;
  originY: number;
  width: number;
  height: number;
}>;

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
