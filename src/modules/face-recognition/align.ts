export type Point = Readonly<{ x: number; y: number }>;

export const SIZE = 112;

export const TEMPLATE: readonly Point[] = [
  { x: 38.2946, y: 51.6963 },
  { x: 73.5318, y: 51.5014 },
  { x: 56.0252, y: 71.7366 },
  { x: (41.5493 + 70.7299) / 2, y: (92.3655 + 92.2041) / 2 },
];

export type Transform = Readonly<{ a: number; b: number; c: number; d: number; e: number; f: number }>;

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

export const alignFace = (landmarks: readonly Point[]): Transform | null => similarity(landmarks, TEMPLATE);

export const apply = (transform: Transform, point: Point): Point => ({
  x: transform.a * point.x + transform.c * point.y + transform.e,
  y: transform.b * point.x + transform.d * point.y + transform.f,
});
