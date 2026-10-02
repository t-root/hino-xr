import type { GestureEvent, GestureType, HandPointer } from "@/shared/contracts/input";
import { clamp01, distance2 } from "@/shared/math/num";
import type { GestureSettings } from "../state/settings";

export type GestureState = "idle" | "tracking" | "hover" | "pinching" | "dragging";

type GestureTick = Readonly<{
  nowMs: number;
  /** `null` while the hand is not tracked; the lost timeout is handled here. */
  pointer: HandPointer | null;
  /** Target currently under the pointer, from the hit-test service. */
  targetId: string | null;
}>;

/**
 * Per-hand interaction state machine.
 *
 * One pinch — thumb and index closing — is the whole vocabulary, and what it
 * means is decided by how it ends: let go where you started and it is a click,
 * keep holding and it becomes a drag. Nothing else in the application invents
 * its own way of being pressed, so a control added next year gets both for
 * free.
 *
 * Nothing here reads the other three fingers, and there is deliberately no
 * second pose to compete with the pinch. A hand closing curls those fingers on
 * its own, so a fist-shaped gesture would enter first and hold the pointer,
 * leaving the pinch inside it unable to be anything at all.
 *
 * Two rules drive the rest of the design: thresholds have hysteresis plus a
 * hold time so noise cannot toggle a state, and a click is only withheld when
 * the hand actually travelled. Holding still long enough becomes a drag so a
 * slider can follow, but releasing in the same place is still a click.
 */

/** Gap closing this fast, while not fully open, counts as a pinch without waiting. */
const CLOSING_PER_SEC = 1.6;

export class GestureStateMachine {
  private state: GestureState = "idle";
  private settings: GestureSettings;

  private lastPointerMs = 0;
  private pinchStartedMs = 0;
  private pinchCandidateSinceMs: number | null = null;
  private releaseCandidateSinceMs: number | null = null;
  private hoverSinceMs: number | null = null;
  private hoverEmittedFor: string | null = null;

  private pinchOrigin: { x: number; y: number } | null = null;
  private capturedTargetId: string | null = null;
  /** True once the hand has actually travelled, not merely held still. */
  private travelled = false;
  /** Smallest pinch ratio seen during the current pinch; 1 when none is held. */
  private tightestRatio = 1;
  /**
   * False after a pinch ends, until the fingers have opened past the enter
   * line. Without this, a release that lands still below `pinchEnterRatio`
   * would start a new pinch on the next frame — which is "I let go and it
   * still thinks I am holding".
   */
  private readyToPinch = true;

  constructor(settings: GestureSettings) {
    this.settings = settings;
  }

  setSettings(settings: GestureSettings): void {
    this.settings = settings;
  }

  get currentState(): GestureState {
    return this.state;
  }

  /**
   * How far a held pinch has got towards becoming a drag, `0..1`.
   *
   * The cursor draws this, so the wearer can watch a hold fill up and let go in
   * time when a click was what they meant.
   */
  holdProgress(nowMs: number): number {
    if (this.state === "dragging") return 1;
    if (this.state !== "pinching") return 0;
    return clamp01((nowMs - this.pinchStartedMs) / Math.max(this.settings.dragHoldMs, 1));
  }

  /** Target holding pointer capture during a pinch or a drag. */
  get captureTargetId(): string | null {
    return this.state === "pinching" || this.state === "dragging" ? this.capturedTargetId : null;
  }

  /**
   * The gap the fingers must open past to let go, right now.
   *
   * During a pinch this is the nearer of the absolute exit and "a little wider
   * than the tightest this pinch got". A click never opens the hand halfway;
   * it opens from however closed it was.
   */
  get releaseRatio(): number {
    const sensitivity = Math.max(this.settings.sensitivity, 0.1);
    const pinchExit = this.settings.pinchExitRatio * sensitivity;
    if (this.state !== "pinching" && this.state !== "dragging") return pinchExit;
    const openDelta = this.settings.pinchOpenDelta / sensitivity;
    return Math.max(openDelta, Math.min(pinchExit, this.tightestRatio + openDelta));
  }

  update(tick: GestureTick): readonly GestureEvent[] {
    const events: GestureEvent[] = [];
    const { pointer, nowMs } = tick;

    if (!pointer) {
      if (this.state !== "idle" && nowMs - this.lastPointerMs > this.settings.lostTimeoutMs) {
        this.cancel(events, nowMs);
      }
      return events;
    }

    this.lastPointerMs = pointer.timestampMs;
    if (this.state === "idle") this.state = "tracking";

    if (this.state === "pinching" || this.state === "dragging") {
      this.tightestRatio = Math.min(this.tightestRatio, pointer.pinchStrength);
    }

    const sensitivity = Math.max(this.settings.sensitivity, 0.1);
    const pinchEnter = this.settings.pinchEnterRatio * sensitivity;
    const pinchExit = this.settings.pinchExitRatio * sensitivity;
    const openDelta = this.settings.pinchOpenDelta / sensitivity;
    const closing = pointer.pinchVelocity <= -CLOSING_PER_SEC;

    // A closing snap starts on the first frame the fingers are clearly coming
    // together. The hold is only for a pinch that is already sitting closed.
    const pinchHeld = this.holdSatisfied(
      pointer.pinchStrength < pinchEnter,
      nowMs,
      "pinchCandidateSinceMs",
      this.settings.pinchEnterHoldMs,
    );
    const pinchSnapped = closing && pointer.pinchStrength < pinchEnter + 0.08;
    // A snap press puts the index next to the middle, close enough that a
    // snappy pinch would enter, mark the hand busy, and cancel the snap. Only
    // a clearly closer thumb-middle pair is that press; a pinch with the other
    // fingers curled in is not.
    // Let go when the fingers open from *this* pinch, not when they reach a
    // stretched pose. The absolute exit is only a backstop. Do not also demand
    // that they clear the enter line: a comfortable pinch never got that tight,
    // and opening a little from it must still count as letting go.
    const opened = pointer.pinchStrength > this.tightestRatio + openDelta;
    const pinchReleased = this.holdSatisfied(
      opened || pointer.pinchStrength > pinchExit,
      nowMs,
      "releaseCandidateSinceMs",
      this.settings.pinchExitHoldMs,
    );

    switch (this.state) {
      case "tracking":
      case "hover": {
        this.updateHover(tick, events, pointer);
        if (!this.readyToPinch) {
          if (pointer.pinchStrength > pinchEnter) this.readyToPinch = true;
        } else if ((pinchHeld || pinchSnapped) && !pointer.snapPress) {
          this.beginPinch(tick, events, pointer);
        }
        break;
      }
      case "pinching": {
        // The pinch point slides as the fingers finish closing, and jumps as
        // they open. Neither is the hand travelling. Follow the close; ignore
        // the open. Otherwise a snappy pinch spends itself as a drag and the
        // click never fires.
        if (pointer.pinchVelocity < -0.3 && this.pinchOrigin) {
          this.pinchOrigin = { x: pointer.position.x, y: pointer.position.y };
        }
        const moved = this.pinchOrigin
          ? distance2(pointer.position.x, pointer.position.y, this.pinchOrigin.x, this.pinchOrigin.y)
          : 0;
        const held = nowMs - this.pinchStartedMs >= this.settings.dragHoldMs;
        if (pointer.pinchVelocity <= 0.3 && moved > this.settings.dragThreshold) this.travelled = true;
        if (pinchReleased) {
          this.endPinch(events, pointer, tick.targetId);
        } else if (this.travelled || held) {
          this.state = "dragging";
          events.push(this.event("dragstart", pointer, this.capturedTargetId));
          events.push(this.event("dragmove", pointer, this.capturedTargetId));
        } else {
          events.push(this.event("pinchmove", pointer, this.capturedTargetId));
        }
        break;
      }
      case "dragging": {
        if (pointer.pinchVelocity < -0.3 && this.pinchOrigin) {
          this.pinchOrigin = { x: pointer.position.x, y: pointer.position.y };
        }
        const moved = this.pinchOrigin
          ? distance2(pointer.position.x, pointer.position.y, this.pinchOrigin.x, this.pinchOrigin.y)
          : 0;
        if (pointer.pinchVelocity <= 0.3 && moved > this.settings.dragThreshold) this.travelled = true;
        if (pinchReleased) {
          events.push(this.event("dragend", pointer, this.capturedTargetId));
          this.endPinch(events, pointer, tick.targetId);
        } else {
          events.push(this.event("dragmove", pointer, this.capturedTargetId));
        }
        break;
      }
    }

    return events;
  }

  private cancel(events: GestureEvent[], nowMs: number, pointer?: HandPointer): void {
    const active = this.state === "pinching" || this.state === "dragging";
    if (active) {
      const fallback: HandPointer = pointer ?? {
        hand: "right",
        position: { x: 0, y: 0, z: 0 },
        velocity: { x: 0, y: 0 },
        pinchStrength: 1,
        pinchVelocity: 0,
        thumbMiddleRatio: 1,
        middleCurlRatio: 1.8,
        snapPress: false,
        confidence: 0,
        timestampMs: nowMs,
      };
      events.push(this.event("cancel", fallback, this.capturedTargetId));
    }
    this.resetInteraction();
    this.hoverSinceMs = null;
    this.hoverEmittedFor = null;
    this.state = "idle";
  }

  private updateHover(tick: GestureTick, events: GestureEvent[], pointer: HandPointer): void {
    if (tick.targetId === null) {
      this.hoverSinceMs = null;
      this.hoverEmittedFor = null;
      this.state = "tracking";
      return;
    }
    if (this.hoverEmittedFor !== tick.targetId && this.hoverSinceMs === null) {
      this.hoverSinceMs = tick.nowMs;
    }
    if (
      this.hoverEmittedFor !== tick.targetId &&
      this.hoverSinceMs !== null &&
      tick.nowMs - this.hoverSinceMs >= this.settings.hoverDwellMs
    ) {
      this.hoverEmittedFor = tick.targetId;
      this.state = "hover";
      events.push(this.event("hover", pointer, tick.targetId));
    }
  }

  private beginPinch(tick: GestureTick, events: GestureEvent[], pointer: HandPointer): void {
    this.state = "pinching";
    this.travelled = false;
    this.tightestRatio = pointer.pinchStrength;
    this.pinchStartedMs = tick.nowMs;
    this.pinchOrigin = { x: pointer.position.x, y: pointer.position.y };
    this.capturedTargetId = tick.targetId;
    this.releaseCandidateSinceMs = null;
    events.push(this.event("pinchstart", pointer, this.capturedTargetId));
  }

  private endPinch(events: GestureEvent[], pointer: HandPointer, currentTargetId: string | null): void {
    // A press that started on nothing can still land: the fingers close, the
    // tracker catches up, and by the time they open there is a control under
    // them. Swallowing that would look like a gesture that never fires.
    const target = this.capturedTargetId ?? currentTargetId;
    events.push(this.event("pinchend", pointer, target));
    // Held still is still a click. Time turning the press into a drag is so a
    // slider can follow the hand *during* the hold; it is not a reason to
    // throw the click away when the hand never went anywhere. Only travelling
    // past the threshold spends the press on a drag instead.
    if (!this.travelled && target) {
      events.push(this.event("select", pointer, target));
    }
    this.resetInteraction();
    this.readyToPinch = false;
    this.state = target ? "hover" : "tracking";
    this.hoverEmittedFor = target;
  }

  /** True once `condition` has held continuously for `holdMs`. */
  private holdSatisfied(
    condition: boolean,
    nowMs: number,
    key: "pinchCandidateSinceMs" | "releaseCandidateSinceMs",
    holdMs: number,
  ): boolean {
    if (!condition) {
      this[key] = null;
      return false;
    }
    const since = this[key];
    if (since === null) {
      this[key] = nowMs;
      return holdMs === 0;
    }
    return nowMs - since >= holdMs;
  }

  private resetInteraction(): void {
    this.pinchOrigin = null;
    this.capturedTargetId = null;
    this.travelled = false;
    this.tightestRatio = 1;
    this.pinchCandidateSinceMs = null;
    this.releaseCandidateSinceMs = null;
  }

  private event(type: GestureType, pointer: HandPointer, targetId: string | null): GestureEvent {
    return targetId === null ? { type, hand: pointer.hand, pointer } : { type, hand: pointer.hand, pointer, targetId };
  }
}
