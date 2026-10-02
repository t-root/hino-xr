import type { NormalizedPoint } from "./vision";

export type Handedness = "left" | "right";

export type PointerPhase = "enter" | "move" | "leave" | "down" | "up" | "cancel";

/**
 * 21 MediaPipe hand landmarks in normalised image space; `z` is relative depth
 * where smaller means closer to the camera.
 */
export type Landmark = Readonly<{ x: number; y: number; z: number }>;

export type HandFrame = Readonly<{
  hand: Handedness;
  landmarks: readonly Landmark[];
  confidence: number;
  timestampMs: number;
}>;

export type HandPointer = Readonly<{
  hand: Handedness;
  /** Smoothed pinch point (midway between thumb and index tips), image space. */
  position: Readonly<{ x: number; y: number; z: number }>;
  /** Normalised units per second, used for snap detection and drag inertia. */
  velocity: NormalizedPoint;
  /** Thumb-index distance normalised by hand size; ~0 when pinched. */
  pinchStrength: number;
  /** How fast that gap is changing, per second. Negative means the pinch is closing. */
  pinchVelocity: number;
  /**
   * Thumb-to-middle-tip gap over hand length. A snap is this pair; a pinch is
   * thumb and index. When this is the closer pair the pinch must stand aside,
   * or a snap press is eaten as a click and the snap itself is cancelled.
   */
  thumbMiddleRatio: number;
  /** Middle fingertip to palm centre, over hand length. Small once folded in. */
  middleCurlRatio: number;
  /**
   * True when thumb and middle are clearly the pair that is touching, so a
   * pinch must stand aside and let the snap run.
   */
  snapPress: boolean;
  confidence: number;
  timestampMs: number;
}>;

/**
 * There is no grab. A pose that reads the middle, ring and little fingers would
 * be a second way of holding something, and it would race the pinch for every
 * press — the fingers curl on their own as a hand closes, so the grab would
 * win, and then the pinch inside it could never be a click. One gesture, judged
 * on two fingertips only.
 */
export type GestureType =
  | "hover"
  | "pinchstart"
  | "pinchmove"
  | "pinchend"
  | "dragstart"
  | "dragmove"
  | "dragend"
  | "select"
  | "cancel"
  | "snap";

export type GestureEvent = Readonly<{
  type: GestureType;
  hand: Handedness;
  pointer: HandPointer;
  targetId?: string;
}>;

/** Anything the hit-test service can resolve a pointer against. */
export type InteractiveTargetKind = "ui" | "detection" | "palette";

export type HitResult = Readonly<{
  targetId: string;
  kind: InteractiveTargetKind;
  /** Point on the target plane in normalised viewport space. */
  point: NormalizedPoint;
  distance: number;
}>;
