import type { Detection, NormalizedRect } from "@/shared/contracts/vision";
import { normalizeBox, type PixelBox } from "@/shared/math/box";

type RawKeypoint = Readonly<{ x: number; y: number }>;

export type RawFaceDetection = Readonly<{
  boundingBox?: PixelBox;
  categories: readonly Readonly<{ score: number }>[];
  keypoints?: readonly RawKeypoint[];
}>;

type FaceMappingOptions = Readonly<{
  imageWidth: number;
  imageHeight: number;
  minConfidence: number;
  maxResults: number;
}>;

const EYE_RIGHT = 0;
const EYE_LEFT = 1;
const NOSE = 2;

const TURNED_RATIO = 0.18;

const facingOf = (keypoints: readonly RawKeypoint[] | undefined): "camera" | "away" | null => {
  const right = keypoints?.[EYE_RIGHT];
  const left = keypoints?.[EYE_LEFT];
  const nose = keypoints?.[NOSE];
  if (!right || !left || !nose) return null;

  const span = Math.abs(left.x - right.x);
  if (span < 1e-4) return "away";

  const middle = (left.x + right.x) / 2;
  return Math.abs(nose.x - middle) / span > TURNED_RATIO ? "away" : "camera";
};

const GROW_X = 1.9;
const GROW_Y = 1.36;
const ABOVE = 0.48;

const wholeHead = (box: NormalizedRect): NormalizedRect => {
  const width = box.width * GROW_X;
  const left = Math.max(0, box.x + box.width / 2 - width / 2);
  const top = Math.max(0, box.y - box.height * ABOVE);
  return {
    x: left,
    y: top,
    width: Math.min(1 - left, width),
    height: Math.min(1 - top, box.height * GROW_Y),
  };
};

export type FaceDetectionSource = Readonly<{ detection: Detection; raw: RawFaceDetection }>;

export const toFaceDetectionsWithSource = (
  raw: readonly RawFaceDetection[],
  options: FaceMappingOptions,
): FaceDetectionSource[] => {
  const found: FaceDetectionSource[] = [];

  for (const item of raw) {
    if (found.length >= options.maxResults) break;

    const score = item.categories[0]?.score ?? 0;
    if (score < options.minConfidence) continue;

    const box = item.boundingBox;
    if (!box) continue;
    const tight = normalizeBox(box, options.imageWidth, options.imageHeight);
    if (!tight) continue;
    const bounds = wholeHead(tight);

    const facing = facingOf(item.keypoints);
    found.push({
      raw: item,
      detection: {
        id: `${found.length}`,
        kind: "face",
        bounds,
        confidence: score,
        ...(facing ? { attributes: { facing } } : {}),
        interaction: { selectable: true },
      },
    });
  }

  return found;
};
