import type { Detection } from "@/shared/contracts/vision";
import { normalizeBox, type PixelBox } from "@/shared/math/box";

export type RawDetection = Readonly<{
  boundingBox?: PixelBox;
  categories: readonly Readonly<{ categoryName?: string; score: number }>[];
}>;

type PersonMappingOptions = Readonly<{
  imageWidth: number;
  imageHeight: number;
  minConfidence: number;
  allowedCategories: readonly string[];
  maxResults: number;
}>;

export const toPersonDetections = (
  raw: readonly RawDetection[],
  options: PersonMappingOptions,
): Detection[] => {
  const detections: Detection[] = [];

  for (const item of raw) {
    if (detections.length >= options.maxResults) break;

    const category = item.categories[0];
    if (!category || category.score < options.minConfidence) continue;
    if (
      options.allowedCategories.length > 0 &&
      !options.allowedCategories.includes(category.categoryName ?? "")
    ) {
      continue;
    }

    const box = item.boundingBox;
    if (!box) continue;
    const bounds = normalizeBox(box, options.imageWidth, options.imageHeight);
    if (!bounds) continue;

    detections.push({
      id: `${detections.length}`,
      kind: "person",
      bounds,
      confidence: category.score,
      interaction: { selectable: true },
    });
  }

  return detections;
};
