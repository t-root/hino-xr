import type { HandPointer, TwoHandEvent } from "@/shared/contracts/input";
import type { GestureSettings } from "../state/settings";

/** Both hands must stay pinched this long before it counts, ms: one hand closing a hair early is not it. */
const HOLD_MS = 90;
/** Hands closer than this (share of the image) have no direction to turn about. */
const MIN_DISTANCE = 0.04;
/** One step never scales more than this, so a lost-and-found hand cannot jump the view. */
const MAX_STEP = 1.5;

const wrap = (angle: number): number => {
  let value = angle;
  while (value > Math.PI) value -= 2 * Math.PI;
  while (value < -Math.PI) value += 2 * Math.PI;
  return value;
};

type Spot = { x: number; y: number };
type Pose = Readonly<{ center: Spot; left: Spot; right: Spot; distance: number; angle: number }>;

const poseOf = (left: HandPointer, right: HandPointer): Pose => {
  const dx = right.position.x - left.position.x;
  const dy = right.position.y - left.position.y;
  return {
    center: { x: (left.position.x + right.position.x) / 2, y: (left.position.y + right.position.y) / 2 },
    left: { x: left.position.x, y: left.position.y },
    right: { x: right.position.x, y: right.position.y },
    distance: Math.hypot(dx, dy),
    angle: Math.atan2(dy, dx),
  };
};

/**
 * Both hands pinching at once: one gesture that is neither hand's own.
 *
 * It is recognised here, once, for the whole application, the same way a click or a drag is. A
 * widget never reads two hands: it gets what the gesture means as events it already understands
 * (a mouse wheel for zoom, see `DomPointerSurface.wheel`), or as the `twohand` event for
 * anything that wants more (turning, panning) and listens on the bus.
 *
 * The hands are pinched when both gaps are under the pinch line, and stay so until either opens
 * past the release line, which is the same hysteresis a single pinch has.
 */
export class TwoHandGesture {
  private active = false;
  private since: number | null = null;
  private last: Pose | null = null;

  constructor(private settings: GestureSettings) {}

  setSettings(settings: GestureSettings): void {
    this.settings = settings;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** The next step of the gesture, or null while it is not under way. */
  update(nowMs: number, left: HandPointer | null, right: HandPointer | null): TwoHandEvent | null {
    const sensitivity = Math.max(this.settings.sensitivity, 0.1);
    const line = (this.active ? this.settings.pinchExitRatio : this.settings.pinchEnterRatio) * sensitivity;
    const held = left !== null && right !== null && left.pinchStrength < line && right.pinchStrength < line;
    if (!held || !left || !right) {
      const wasActive = this.active;
      const pose = this.last;
      this.active = false;
      this.since = null;
      this.last = null;
      return wasActive && pose ? this.event("end", pose, 1, 0, { x: 0, y: 0 }) : null;
    }

    const pose = poseOf(left, right);
    if (!this.active) {
      this.since ??= nowMs;
      if (nowMs - this.since < HOLD_MS || pose.distance < MIN_DISTANCE) return null;
      this.active = true;
      this.last = pose;
      return this.event("start", pose, 1, 0, { x: 0, y: 0 });
    }

    const before = this.last ?? pose;
    this.last = pose;
    const scale = before.distance > 0 ? Math.min(MAX_STEP, Math.max(1 / MAX_STEP, pose.distance / before.distance)) : 1;
    return this.event("move", pose, scale, wrap(pose.angle - before.angle), {
      x: pose.center.x - before.center.x,
      y: pose.center.y - before.center.y,
    });
  }

  private event(
    phase: TwoHandEvent["phase"],
    pose: Pose,
    scale: number,
    rotation: number,
    pan: { x: number; y: number },
  ): TwoHandEvent {
    return { phase, center: pose.center, left: pose.left, right: pose.right, distance: pose.distance, scale, rotation, pan };
  }
}
