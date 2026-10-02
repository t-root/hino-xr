import type { Detection } from "@/shared/contracts/vision";
import { normalizeBox, type PixelBox } from "@/shared/math/box";

/**
 * The shape of a MediaPipe object detection, narrowed to what is used here.
 * Declared structurally so this file needs no model and no browser.
 */
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

/**
 * Model output to contract detections: filter, normalise, cap.
 *
 * `kind` carries the model's own class name (`cup`, `cell phone`, …) so the
 * module can name each box in whatever language the interface is in when it
 * is drawn; the worker never hears about languages. Ids are positional here;
 * stable ids are assigned on the module side, where earlier frames are known.
 */
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
