import {
  clearsHysteresis,
  gravityFromEuler,
  gravityInScreen,
  nearestTurnFromGravity,
  screenAngleDeg,
  type Turn,
} from "./orientation";

const DWELL_MS = 280;
const MOTION_STALE_MS = 220;

type AutoOrientationHost = Pick<EventTarget, "addEventListener" | "removeEventListener">;

/**
 * Turns gravity into the same quarter-turns the rotate button uses.
 *
 * A headset nods and rolls. Following every degree would spin the menu while
 * the wearer is only looking around, so readings have to leave the current
 * quarter by a wide margin and stay there for a moment before anything moves.
 * Looking up or down is ignored: gravity then leaves the screen plane.
 */
export class AutoOrientation {
  private enabled = false;
  private current: Turn;
  private pending: Turn | null = null;
  private pendingSinceMs = 0;
  private lastMotionMs = 0;
  private readonly host: AutoOrientationHost;
  private readonly onTurn: (turn: Turn) => void;
  private readonly now: () => number;
  private readonly screenAngle: () => number;

  constructor(
    current: Turn,
    onTurn: (turn: Turn) => void,
    host: AutoOrientationHost = window,
    now: () => number = () => performance.now(),
    screenAngle: () => number = () => screenAngleDeg(),
  ) {
    this.current = current;
    this.onTurn = onTurn;
    this.host = host;
    this.now = now;
    this.screenAngle = screenAngle;
    this.onMotion = this.onMotion.bind(this);
    this.onOrientation = this.onOrientation.bind(this);
  }

  setCurrent(turn: Turn): void {
    this.current = turn;
    this.pending = null;
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    this.pending = null;
    if (enabled) this.attach();
    else this.detach();
  }

  dispose(): void {
    this.setEnabled(false);
  }

  private attach(): void {
    this.host.addEventListener("devicemotion", this.onMotion as EventListener);
    this.host.addEventListener("deviceorientation", this.onOrientation as EventListener);
  }

  private detach(): void {
    this.host.removeEventListener("devicemotion", this.onMotion as EventListener);
    this.host.removeEventListener("deviceorientation", this.onOrientation as EventListener);
  }

  private onMotion(event: DeviceMotionEvent): void {
    if (!this.enabled) return;
    const gravity = event.accelerationIncludingGravity;
    if (!gravity || gravity.x === null || gravity.y === null) return;
    const nowMs = this.now();
    this.lastMotionMs = nowMs;
    this.consider(gravity.x, gravity.y, gravity.z ?? undefined, nowMs);
  }

  private onOrientation(event: DeviceOrientationEvent): void {
    if (!this.enabled) return;
    const nowMs = this.now();
    if (nowMs - this.lastMotionMs < MOTION_STALE_MS) return;
    if (event.beta === null || event.gamma === null) return;
    const gravity = gravityFromEuler(event.beta, event.gamma);
    this.consider(gravity.x, gravity.y, gravity.z, nowMs);
  }

  consider(deviceX: number, deviceY: number, deviceZ: number | undefined, nowMs: number): void {
    if (!this.enabled) return;
    const screen = gravityInScreen(deviceX, deviceY, this.screenAngle());
    const z = deviceZ;
    const nearest = nearestTurnFromGravity(screen.x, screen.y, z);
    if (nearest === null || nearest === this.current) {
      this.pending = null;
      return;
    }
    if (!clearsHysteresis(this.current, screen.x, screen.y, z)) {
      this.pending = null;
      return;
    }
    if (this.pending !== nearest) {
      this.pending = nearest;
      this.pendingSinceMs = nowMs;
      return;
    }
    if (nowMs - this.pendingSinceMs < DWELL_MS) return;
    this.current = nearest;
    this.pending = null;
    this.onTurn(nearest);
  }
}
