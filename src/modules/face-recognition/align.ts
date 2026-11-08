/**
 * Lining a face up for the recognition model.
 *
 * The model was trained on faces turned, scaled and cropped so the eyes, nose and mouth fall on fixed places in a
 * 112 by 112 picture. A face as the camera sees it is anywhere, at any size and tilt, so each is moved onto those
 * places first: the same face then looks the same to the model whatever the camera did.
 */

export type Point = Readonly<{ x: number; y: number }>;

export const SIZE = 112;

/**
 * Where the left eye, right eye, nose tip and the middle of the mouth fall in the 112 picture the model expects
 * (the standard five-point template, with the mouth's two corners averaged into one point).
 */
export const TEMPLATE: readonly Point[] = [
  { x: 38.2946, y: 51.6963 },
  { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: (41.5493 + 70.7299) / 2, y: (92.3655 + 92.2041) / 2 },
];

/** A canvas transform: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`. */
export type Transform = Readonly<{ a: number; b: number; c: number; d: number; e: number; f: number }>;

/**
 * The turn, scale and shift that best put `from` onto `to` (least squares, no mirroring), found with complex
 * numbers: a point is `x + iy`, and the move is `z' = k·z + m` for a complex `k` (turn and scale) and `m` (shift).
 */
export const similarity = (from: readonly Point[], to: readonly Point[]): Transform | null => {
  const count = Math.min(from.length, to.length);
  if (count < 2) return null;
  let fromX = 0;
  let fromY = 0;
  let toX = 0;
  let toY = 0;
  for (let i = 0; i < count; i += 1) {
    fromX += (from[i] as Point).x;
    fromY += (from[i] as Point).y;
    toX += (to[i] as Point).x;
    toY += (to[i] as Point).y;
  }
  fromX /= count;
  fromY /= count;
  toX /= count;
  toY /= count;

  let real = 0;
  let imaginary = 0;
  let spread = 0;
  for (let i = 0; i < count; i += 1) {
    const sx = (from[i] as Point).x - fromX;
    const sy = (from[i] as Point).y - fromY;
    const dx = (to[i] as Point).x - toX;
    const dy = (to[i] as Point).y - toY;
    // conj(s) · d
    real += sx * dx + sy * dy;
    imaginary += sx * dy - sy * dx;
    spread += sx * sx + sy * sy;
  }
  if (spread < 1e-9) return null;
  const kr = real / spread;
  const ki = imaginary / spread;
  return {
    a: kr,
    b: ki,
    c: -ki,
    d: kr,
    e: toX - (kr * fromX - ki * fromY),
    f: toY - (ki * fromX + kr * fromY),
  };
};

/**
 * Where BlazeFace puts a face's eyes, nose and mouth, in the order the template has them: the eye on the
 * left of the picture first, whichever way round the camera is. `keypoints` is BlazeFace's own order: the
 * two eyes, the nose tip, the mouth, then the two ears.
 */
export const landmarksFor = (
  keypoints: readonly Point[] | undefined,
  width: number,
  height: number,
): Point[] | null => {
  if (!keypoints || keypoints.length < 4) return null;
  const at = (index: number): Point => ({
    x: (keypoints[index] as Point).x * width,
    y: (keypoints[index] as Point).y * height,
  });
  const [first, second] = [at(0), at(1)];
  const [left, right] = first.x <= second.x ? [first, second] : [second, first];
  return [left, right, at(2), at(3)];
};

/** The transform that lines a face up, or null when its landmarks cannot define one. */
export const alignFace = (landmarks: readonly Point[]): Transform | null => similarity(landmarks, TEMPLATE);

/** Applies a transform to a point; used to check an alignment against the template. */
export const apply = (transform: Transform, point: Point): Point => ({
  x: transform.a * point.x + transform.c * point.y + transform.e,
  y: transform.b * point.x + transform.d * point.y + transform.f,
});
