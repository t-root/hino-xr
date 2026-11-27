import type { Detection } from "@/shared/contracts/vision";
import { normalizeBox, type PixelBox } from "@/shared/math/box";

export type RawDetection = Readonly<{
  boundingBox?: PixelBox;
  categories: readonly Readonly<{ categoryName?: string; score: number }>[];
}>;

type ObjectMappingOptions = Readonly<{
  imageWidth: number;
  imageHeight: number;
  minConfidence: number;
  maxResults: number;
}>;

export const toObjectDetections = (raw: readonly RawDetection[], options: ObjectMappingOptions): Detection[] => {
  const detections: Detection[] = [];

  for (const item of raw) {
    if (detections.length >= options.maxResults) break;

    const category = item.categories[0];
    if (!category || category.score < options.minConfidence) continue;

    const box = item.boundingBox;
    if (!box) continue;
    const bounds = normalizeBox(box, options.imageWidth, options.imageHeight);
    if (!bounds) continue;

    detections.push({
      id: `${detections.length}`,
      kind: category.categoryName || "object",
      bounds,
      confidence: category.score,
      interaction: { selectable: true },
    });
  }

  return detections;
};
