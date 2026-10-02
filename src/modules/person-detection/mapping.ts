import type { Detection } from "@/shared/contracts/vision";
import { normalizeBox, type PixelBox } from "@/shared/math/box";

/**
 * The shape of a MediaPipe object detection, narrowed to what is used here.
 * Declared structurally so this file, and its tests, need no model at all.
 */
export type RawDetection = Readonly<{
  boundingBox?: PixelBox;
  categories: readonly Readonly<{ categoryName?: string; score: number }>[];
}>;

type PersonMappingOptions = Readonly<{
  imageWidth: number;
  imageHeight: number;
  minConfidence: number;
  /** Category names kept; empty keeps everything the model reports. */
  allowedCategories: readonly string[];
  maxResults: number;
}>;

/**
 * Model output to contract detections: filter, normalise, cap.
 *
 * Kept apart from the worker so the part that can be wrong about coordinates is
 * the part that can be tested without a GPU, a model download or a browser.
 * Ids here are positional only — stable tracking ids are assigned on the module
 * side, where boxes from previous frames are known.
 */
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
