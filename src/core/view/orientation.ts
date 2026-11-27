export type Turn = 0 | 90 | 180 | 270;

export const isTurn = (value: unknown): value is Turn =>
  value === 0 || value === 90 || value === 180 || value === 270;

export const nextTurn = (turn: Turn): Turn => ((turn + 90) % 360) as Turn;

const snapTurn = (degrees: number): Turn => {
  const snapped = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
  return (snapped === 90 || snapped === 180 || snapped === 270 ? snapped : 0) as Turn;
};

const angleDelta = (from: number, to: number): number => {
  const raw = ((to - from) % 360 + 360) % 360;
  return raw > 180 ? raw - 360 : raw;
};

const IN_PLANE_RATIO = 0.4;

const TURN_HYSTERESIS_DEG = 18;

export const screenAngleDeg = (
  orientation: Readonly<{ angle?: number }> | null | undefined = typeof screen === "undefined"
    ? undefined
    : screen.orientation,
  windowOrientation: number | undefined = typeof window === "undefined"
    ? undefined
    : (window as Window & { orientation?: number }).orientation,
): number => {
  if (typeof orientation?.angle === "number") return orientation.angle;
  if (typeof windowOrientation === "number") return windowOrientation;
  return 0;
};

export const gravityInScreen = (
  deviceX: number,
  deviceY: number,
  screenDeg: number,
): { readonly x: number; readonly y: number } => {
  const rad = (screenDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: deviceX * cos - deviceY * sin, y: deviceX * sin + deviceY * cos };
};

const inPlaneGravity = (
  x: number,
  y: number,
  z?: number,
): { readonly x: number; readonly y: number } | null => {
  const plane = Math.hypot(x, y);
  const total = z === undefined ? Math.max(plane, Number.EPSILON) : Math.hypot(x, y, z);
  if (plane < IN_PLANE_RATIO * total) return null;
  return { x, y };
};

export const gravityFromEuler = (
  betaDeg: number,
  gammaDeg: number,
): { readonly x: number; readonly y: number; readonly z: number } => {
  const beta = (betaDeg * Math.PI) / 180;
  const gamma = (gammaDeg * Math.PI) / 180;
  return {
    x: Math.sin(gamma),
    y: Math.sin(beta) * Math.cos(gamma),
    z: Math.cos(beta) * Math.cos(gamma),
  };
};

export const nearestTurnFromGravity = (x: number, y: number, z?: number): Turn | null => {
  const plane = inPlaneGravity(x, y, z);
  if (!plane) return null;
  return snapTurn((Math.atan2(plane.x, plane.y) * 180) / Math.PI);
};

export const clearsHysteresis = (current: Turn, x: number, y: number, z?: number): boolean => {
  const plane = inPlaneGravity(x, y, z);
  if (!plane) return false;
  const angle = (Math.atan2(plane.x, plane.y) * 180) / Math.PI;
  return Math.abs(angleDelta(current, angle)) >= 45 + TURN_HYSTERESIS_DEG;
};
