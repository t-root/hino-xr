export type Turn = 0 | 90 | 180 | 270;

export const isTurn = (value: unknown): value is Turn =>
  value === 0 || value === 90 || value === 180 || value === 270;

/** One tap of the rotate button: a quarter-turn, wrapping around. */
export const nextTurn = (turn: Turn): Turn => ((turn + 90) % 360) as Turn;

/** Wrap any degree value onto a quarter-turn. */
const snapTurn = (degrees: number): Turn => {
  const snapped = ((Math.round(degrees / 90) * 90) % 360 + 360) % 360;
  return (snapped === 90 || snapped === 180 || snapped === 270 ? snapped : 0) as Turn;
};

/**
 * Smallest signed difference from `from` to `to` in degrees, in (-180, 180].
 */
const angleDelta = (from: number, to: number): number => {
  const raw = ((to - from) % 360 + 360) % 360;
  return raw > 180 ? raw - 360 : raw;
};

/**
 * Gravity in the screen plane has to be this strong, as a share of the whole
 * vector, before it is allowed to choose a quarter-turn.
 *
 * Looking up or down puts gravity mostly out of the screen. Snapping on that
 * leftover would spin the interface while the wearer is only nodding.
 */
const IN_PLANE_RATIO = 0.4;

/**
 * How far past a 45° boundary the reading must travel before the current
 * quarter-turn gives way. Without this, looking a little off-centre flips the
 * interface back and forth across the diagonal.
 */
const TURN_HYSTERESIS_DEG = 18;

/**
 * Clockwise angle of the screen relative to the device, in degrees.
 *
 * Device sensors speak in the phone's own axes. CSS speaks in the window. When
 * the OS has already turned the page, those two disagree, and a gravity reading
 * used raw would double-rotate the interface.
 */
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

/**
 * Rotates a device-space vector into the window's CSS axes by the screen's
 * own turn. `screenDeg` clockwise moves device +x onto CSS +y at 90°, which
 * is what a landscape window already did to the page.
 */
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

/**
 * Gravity in the screen plane, or `null` when the wearer is looking too far
 * up or down for a quarter-turn to be meaningful.
 *
 * `x`/`y`/`z` are device coordinates: +x right, +y top of the phone, +z out
 * of the screen. `accelerationIncludingGravity` on a phone standing upright
 * is roughly `(0, +g, 0)` — the vector points at the sky, not at the floor.
 */
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

/**
 * World-up in the device's screen plane from the Device Orientation Euler
 * angles, as a unit vector. `beta` is front-to-back, `gamma` left-to-right.
 *
 * This is the fallback when `devicemotion` is silent. It is already the
 * in-plane part of gravity, so a small magnitude means looking up or down.
 */
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

/**
 * Nearest quarter-turn that puts CSS "up" on world-up, given gravity in
 * screen axes. `null` when the reading is too close to looking up or down.
 *
 * `atan2(x, y)` is 0 when the vector points at the top of the window, which
 * is the un-rotated interface.
 */
export const nearestTurnFromGravity = (x: number, y: number, z?: number): Turn | null => {
  const plane = inPlaneGravity(x, y, z);
  if (!plane) return null;
  return snapTurn((Math.atan2(plane.x, plane.y) * 180) / Math.PI);
};

/**
 * Whether `candidate` is far enough from `current` to be worth switching to.
 *
 * The live angle must leave the current quarter by more than 45° plus the
 * hysteresis band. A reading whose nearest snap is different but that is
 * still sitting on the diagonal is not a decision yet.
 */
export const clearsHysteresis = (current: Turn, x: number, y: number, z?: number): boolean => {
  const plane = inPlaneGravity(x, y, z);
  if (!plane) return false;
  const angle = (Math.atan2(plane.x, plane.y) * 180) / Math.PI;
  return Math.abs(angleDelta(current, angle)) >= 45 + TURN_HYSTERESIS_DEG;
};
