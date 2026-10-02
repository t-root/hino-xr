import type { Detection } from "@/shared/contracts/vision";
import { normalizeBox, type PixelBox } from "@/shared/math/box";

/**
 * A MediaPipe face detection, narrowed to what is used here and declared
 * structurally, so this file and its tests need no model and no browser.
 *
 * Keypoints come back already normalised, in BlazeFace's fixed order: two eyes,
 * nose tip, mouth, then the two ear points.
 */
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

/** Past this much of the eye span, the nose has swung off the middle. */
const TURNED_RATIO = 0.18;

/**
 * Whether the face is pointed at the camera, from where the nose sits between
 * the eyes.
 *
 * Deliberately reports "turned" without a side. Frames may arrive mirrored, and
 * a left/right that flips with a setting is worse than one that is not offered:
 * the useful part — is this person looking at me — survives either way.
 */
const facingOf = (keypoints: readonly RawKeypoint[] | undefined): "camera" | "away" | null => {
  const right = keypoints?.[EYE_RIGHT];
  const left = keypoints?.[EYE_LEFT];
  const nose = keypoints?.[NOSE];
  if (!right || !left || !nose) return null;

  const span = Math.abs(left.x - right.x);
  // Eyes on top of each other means a profile so extreme there is no middle
  // left to measure against.
  if (span < 1e-4) return "away";

  const middle = (left.x + right.x) / 2;
  return Math.abs(nose.x - middle) / span > TURNED_RATIO ? "away" : "camera";
};

/**
 * Model output to contract detections: filter, normalise, cap.
 *
 * Ids are positional; stable ids across frames are assigned by the module,
 * which is the side that remembers the previous frame.
 */
export const toFaceDetections = (
  raw: readonly RawFaceDetection[],
  options: FaceMappingOptions,
): Detection[] => {
  const detections: Detection[] = [];

  for (const item of raw) {
    if (detections.length >= options.maxResults) break;

    const score = item.categories[0]?.score ?? 0;
    if (score < options.minConfidence) continue;

    const box = item.boundingBox;
    if (!box) continue;
    const bounds = normalizeBox(box, options.imageWidth, options.imageHeight);
    if (!bounds) continue;

    const facing = facingOf(item.keypoints);
    detections.push({
      id: `${detections.length}`,
      kind: "face",
      bounds,
      confidence: score,
      // No name, ever: this plugin finds faces, it does not tell them apart.
      ...(facing ? { attributes: { facing } } : {}),
      interaction: { selectable: true },
    });
  }

  return detections;
};
