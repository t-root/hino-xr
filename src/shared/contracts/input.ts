import type { NormalizedPoint } from "./vision";

export type Handedness = "left" | "right";

export type PointerPhase = "enter" | "move" | "leave" | "down" | "up" | "cancel";

export type Landmark = Readonly<{ x: number; y: number; z: number }>;

export type HandFrame = Readonly<{
  hand: Handedness;
  landmarks: readonly Landmark[];
  confidence: number;
  timestampMs: number;
  aspect?: number;
}>;

export type HandPointer = Readonly<{
  hand: Handedness;
  position: Readonly<{ x: number; y: number; z: number }>;
  velocity: NormalizedPoint;
  pinchStrength: number;
  pinchVelocity: number;
  thumbMiddleRatio: number;
  middleCurlRatio: number;
  snapPress: boolean;
  confidence: number;
  timestampMs: number;
}>;

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

export type TwoHandEvent = Readonly<{
  phase: "start" | "move" | "end";
  center: Readonly<{ x: number; y: number }>;
  left: Readonly<{ x: number; y: number }>;
  right: Readonly<{ x: number; y: number }>;
  distance: number;
  scale: number;
  rotation: number;
  pan: Readonly<{ x: number; y: number }>;
}>;

export type TwoHandDomDetail = TwoHandEvent &
  Readonly<{
    client: Readonly<{ x: number; y: number }>;
    hands: Readonly<{ left: Readonly<{ x: number; y: number }>; right: Readonly<{ x: number; y: number }> }>;
  }>;

export type InteractiveTargetKind = "ui" | "detection" | "palette";

export type HitResult = Readonly<{
  targetId: string;
  kind: InteractiveTargetKind;
  point: NormalizedPoint;
  distance: number;
}>;
