import type { Detection, NormalizedRect } from "@/shared/contracts/vision";
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
 * BlazeFace boxes the face features, which drawn on a person is a narrow box that misses the hair and ears and
 * runs on below the chin. This fits the head: wider, a little taller, and moved up so its top is the hair and
 * its bottom is the chin. Measured on a real frame: head 1.9 times as wide as the face box, 1.36 as tall,
 * starting 0.48 of the box's height above it.
 */
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

/** A detection and the model's own result for it, so the landmarks that line the face up can be read. */
export type FaceDetectionSource = Readonly<{ detection: Detection; raw: RawFaceDetection }>;

/**
 * Model output to contract detections: filter, normalise, cap.
 *
 * Ids are positional; stable ids across frames are assigned by the module,
 * which is the side that remembers the previous frame.
 */
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

export const toFaceDetections = (raw: readonly RawFaceDetection[], options: FaceMappingOptions): Detection[] =>
  toFaceDetectionsWithSource(raw, options).map((item) => item.detection);
