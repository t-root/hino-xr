import type { GestureEvent, GestureType, HandPointer } from "@/shared/contracts/input";
import { clamp01, distance2 } from "@/shared/math/num";
import type { GestureSettings } from "../state/settings";

export type GestureState = "idle" | "tracking" | "hover" | "pinching" | "dragging";

type GestureTick = Readonly<{
  nowMs: number;
  pointer: HandPointer | null;
  targetId: string | null;
}>;

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
  private travelled = false;
  private tightestRatio = 1;
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

  holdProgress(nowMs: number): number {
    if (this.state === "dragging") return 1;
    if (this.state !== "pinching") return 0;
    return clamp01((nowMs - this.pinchStartedMs) / Math.max(this.settings.dragHoldMs, 1));
  }

  get captureTargetId(): string | null {
    return this.state === "pinching" || this.state === "dragging" ? this.capturedTargetId : null;
  }

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

    const pinchHeld = this.holdSatisfied(
      pointer.pinchStrength < pinchEnter,
      nowMs,
      "pinchCandidateSinceMs",
      this.settings.pinchEnterHoldMs,
    );
    const pinchSnapped = closing && pointer.pinchStrength < pinchEnter + 0.08;
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

  abort(nowMs: number, pointer?: HandPointer): readonly GestureEvent[] {
    const events: GestureEvent[] = [];
    this.cancel(events, nowMs, pointer);
    this.readyToPinch = false;
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
    const target = this.capturedTargetId ?? currentTargetId;
    events.push(this.event("pinchend", pointer, target));
    if (!this.travelled && target) {
      events.push(this.event("select", pointer, target));
    }
    this.resetInteraction();
    this.readyToPinch = false;
    this.state = target ? "hover" : "tracking";
    this.hoverEmittedFor = target;
  }

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
