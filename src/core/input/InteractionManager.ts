import type { GestureEvent, HandFrame, HandPointer, Handedness, TwoHandEvent } from "@/shared/contracts/input";
import type { EventBus } from "../events/EventBus";
import type { RuntimeEvents } from "../events/events";
import type { CursorLayer, CursorPhase, CursorVisual } from "../rendering/CursorLayer";
import type { GestureState } from "./GestureStateMachine";
import type { GestureSettings, SnapSettings } from "../state/settings";
import type { PointerSurface } from "./DomPointerSurface";
import { createLogger } from "../observability/diagnostics";
import { GestureStateMachine } from "./GestureStateMachine";
import { HandSmoother } from "./HandSmoother";
import type { HitTestService } from "./HitTestService";
import type { InteractiveRegistry } from "./InteractiveRegistry";
import { SnapGestureRecognizer, snapFeatures, type SnapState } from "./SnapGestureRecognizer";
import { TwoHandGesture } from "./TwoHandGesture";

const phaseOf = (state: GestureState, hovering: boolean): CursorPhase => {
  if (state === "dragging") return "dragging";
  if (state === "pinching") return "pinching";
  return hovering ? "hover" : "tracking";
};

type HandRuntime = {
  readonly smoother: HandSmoother;
  readonly machine: GestureStateMachine;
  readonly snap: SnapGestureRecognizer;
  pointer: HandPointer | null;
  hoveredTargetId: string | null;
  lastTargetId: string | null;
  lastFrameMs: number;
  closestRatio: number;
  closestAtMs: number;
};

export type HandProbe = Readonly<{
  hand: Handedness;
  state: GestureState;
  pinchRatio: number;
  closestRatio: number;
  enterRatio: number;
  exitRatio: number;
  target: string | null;
  snapState: SnapState;
  thumbMiddleRatio: number;
  middleCurlRatio: number;
}>;

const WHEEL_PX_PER_E = 86.6;

const CLOSEST_WINDOW_MS = 1000;

export class InteractionManager {
  private readonly hands = new Map<Handedness, HandRuntime>();
  private readonly ownerByTarget = new Map<string, Handedness>();
  private settings: GestureSettings;
  private snapSettings: SnapSettings;
  private snapEnabled: boolean;
  private selectedTargetId: string | null = null;
  private readonly twoHand: TwoHandGesture;
  private readonly snapLog = createLogger("snap");
  private lastSnapLogMs = 0;

  constructor(
    private readonly bus: EventBus<RuntimeEvents>,
    private readonly registry: InteractiveRegistry,
    private readonly hitTest: HitTestService,
    private readonly cursors: CursorLayer,
    private readonly mapperDisplay: (point: { x: number; y: number }) => { x: number; y: number },
    settings: GestureSettings,
    snapSettings: SnapSettings,
    snapEnabled: boolean,
    private readonly surface: PointerSurface | null = null,
  ) {
    this.settings = settings;
    this.snapSettings = snapSettings;
    this.snapEnabled = snapEnabled;
    this.twoHand = new TwoHandGesture(settings);
  }

  setSettings(settings: GestureSettings, snapSettings: SnapSettings, snapEnabled: boolean): void {
    this.settings = settings;
    this.twoHand.setSettings(settings);
    this.snapSettings = snapSettings;
    this.snapEnabled = snapEnabled;
    for (const runtime of this.hands.values()) {
      runtime.smoother.setSettings(settings);
      runtime.machine.setSettings(settings);
      runtime.snap.setSettings(snapSettings);
    }
  }

  get hoveredTargetId(): string | null {
    for (const runtime of this.hands.values()) {
      if (runtime.hoveredTargetId) return runtime.hoveredTargetId;
    }
    return null;
  }

  get selectedId(): string | null {
    return this.selectedTargetId;
  }

  probes(): readonly HandProbe[] {
    const probes: HandProbe[] = [];
    for (const [hand, runtime] of this.hands) {
      const pointer = runtime.pointer;
      if (!pointer) continue;
      probes.push({
        hand,
        state: runtime.machine.currentState,
        pinchRatio: pointer.pinchStrength,
        closestRatio: runtime.closestRatio,
        enterRatio: this.settings.pinchEnterRatio * Math.max(this.settings.sensitivity, 0.1),
        exitRatio: runtime.machine.releaseRatio,
        target: this.describeTarget(runtime.lastTargetId),
        snapState: runtime.snap.currentState,
        thumbMiddleRatio: pointer.thumbMiddleRatio,
        middleCurlRatio: pointer.middleCurlRatio,
      });
    }
    return probes;
  }

  describeTarget(targetId: string | null): string | null {
    if (!targetId) return null;
    return this.surface?.describe(targetId) ?? targetId;
  }

  isHandBusy(hand: Handedness): boolean {
    const state = this.hands.get(hand)?.machine.currentState;
    return state === "pinching" || state === "dragging";
  }

  ingest(hands: readonly HandFrame[]): void {
    const pointers: HandPointer[] = [];
    for (const frame of hands) {
      const runtime = this.runtimeFor(frame.hand);
      runtime.lastFrameMs = frame.timestampMs;
      const pointer = runtime.smoother.update(frame);
      runtime.pointer = pointer;
      if (!pointer) continue;
      pointers.push(pointer);
      this.detectSnap(runtime, frame, pointer);
    }
    this.bus.emit("hand.tracked", { pointers, hands });
  }

  private detectSnap(runtime: HandRuntime, frame: HandFrame, pointer: HandPointer): void {
    if (!this.snapEnabled) return;
    const features = snapFeatures(frame);
    if (!features) return;
    const snapped = runtime.snap.update({
      nowMs: frame.timestampMs,
      features,
      busy: this.isHandBusy(frame.hand),
    });
    if (features.thumbMiddle < 1.2 && frame.timestampMs - this.lastSnapLogMs > 250) {
      this.lastSnapLogMs = frame.timestampMs;
      this.snapLog.info("pose", {
        hand: frame.hand,
        state: runtime.snap.currentState,
        thumbMiddle: Number(features.thumbMiddle.toFixed(2)),
        thumbIndex: Number(features.thumbIndex.toFixed(2)),
        middleWrist: Number(features.middleWrist.toFixed(2)),
      });
    }
    if (snapped) this.dispatch(runtime, [{ type: "snap", hand: pointer.hand, pointer }], frame.timestampMs);
  }

  update(nowMs: number): void {
    const visuals: CursorVisual[] = [];
    const live: Record<Handedness, HandPointer | null> = { left: null, right: null };

    for (const [hand, runtime] of this.hands) {
      const lost = nowMs - runtime.lastFrameMs > this.settings.lostTimeoutMs;
      const pointer = lost ? null : runtime.pointer;

      const captured = runtime.machine.captureTargetId;
      const targetId = pointer ? this.resolveTarget(hand, pointer, captured) : null;
      runtime.lastTargetId = targetId;
      const events = runtime.machine.update({ nowMs, pointer, targetId });
      this.dispatch(runtime, events, nowMs);

      if (lost) {
        runtime.pointer = null;
        runtime.smoother.reset();
        this.releaseHover(runtime, hand);
        continue;
      }
      if (!pointer) continue;
      live[hand] = pointer;

      const stale = nowMs - runtime.closestAtMs > CLOSEST_WINDOW_MS;
      if (stale || pointer.pinchStrength < runtime.closestRatio) {
        runtime.closestRatio = pointer.pinchStrength;
        runtime.closestAtMs = nowMs;
      }

      visuals.push({
        hand,
        point: this.mapperDisplay({ x: pointer.position.x, y: pointer.position.y }),
        phase: phaseOf(runtime.machine.currentState, runtime.hoveredTargetId !== null),
        holdProgress: Math.max(runtime.machine.holdProgress(nowMs), runtime.snap.progress()),
        confidence: pointer.confidence,
      });
    }

    this.cursors.update(visuals, nowMs);

    const step = this.twoHand.update(nowMs, live.left, live.right);
    if (step) this.handleTwoHand(step, nowMs, live);
  }

  private handleTwoHand(step: TwoHandEvent, nowMs: number, live: Record<Handedness, HandPointer | null>): void {
    if (step.phase === "start") {
      for (const [hand, runtime] of this.hands) {
        this.dispatch(runtime, runtime.machine.abort(nowMs, live[hand] ?? undefined), nowMs);
      }
    }
    this.bus.emit("twohand", step);
    if (this.surface?.twoHand?.(step)) return;
    if (step.phase !== "move" || step.scale === 1) return;
    const deltaY = -Math.log(step.scale) * WHEEL_PX_PER_E;
    if (Math.abs(deltaY) >= 1) this.surface?.wheel?.(step.center, deltaY);
  }

  private resolveTarget(hand: Handedness, pointer: HandPointer, captured: string | null): string | null {
    if (captured) return captured;
    const targetId =
      this.surface?.hit(pointer.position) ??
      this.hitTest.hit({ x: pointer.position.x, y: pointer.position.y })?.targetId ??
      null;
    if (!targetId) return null;
    const owner = this.ownerByTarget.get(targetId);
    if (owner && owner !== hand) return null;
    return targetId;
  }

  private dispatch(runtime: HandRuntime, events: readonly GestureEvent[], nowMs: number): void {
    for (const event of events) {
      const onSurface = event.targetId ? this.surface?.owns(event.targetId) === true : false;
      const target = event.targetId && !onSurface ? this.registry.get(event.targetId) : undefined;

      switch (event.type) {
        case "hover":
          this.setHover(runtime, event.targetId ?? null, event);
          break;
        case "pinchstart":
          if (event.targetId) this.ownerByTarget.set(event.targetId, event.hand);
          this.emitInteraction("down", event);
          break;
        case "pinchend":
        case "dragend":
          if (event.targetId) this.ownerByTarget.delete(event.targetId);
          this.emitInteraction("up", event);
          break;
        case "select":
          this.selectedTargetId = event.targetId ?? null;
          this.cursors.flash(event.hand, nowMs);
          break;
        case "snap":
          this.cursors.flash(event.hand, nowMs);
          break;
        case "cancel":
          if (event.targetId) this.ownerByTarget.delete(event.targetId);
          this.emitInteraction("cancel", event);
          break;
        case "pinchmove":
        case "dragmove":
          this.emitInteraction("move", event);
          break;
        default:
          break;
      }

      if (onSurface) this.surface?.handle(event);
      else if (target && target.enabled) target.onEvent?.(event);
      this.bus.emit("gesture", event);
    }
  }

  private setHover(runtime: HandRuntime, targetId: string | null, event: GestureEvent): void {
    if (runtime.hoveredTargetId === targetId) return;
    if (runtime.hoveredTargetId) {
      this.emitInteraction("leave", { ...event, targetId: runtime.hoveredTargetId });
    }
    runtime.hoveredTargetId = targetId;
    this.surface?.hover(targetId);
    if (targetId) this.emitInteraction("enter", event);
  }

  private releaseHover(runtime: HandRuntime, hand: Handedness): void {
    if (runtime.hoveredTargetId) {
      runtime.hoveredTargetId = null;
      this.surface?.hover(null);
    }
    for (const [targetId, owner] of this.ownerByTarget) {
      if (owner === hand) this.ownerByTarget.delete(targetId);
    }
  }

  private emitInteraction(
    type: "enter" | "move" | "leave" | "down" | "up" | "cancel",
    event: GestureEvent,
  ): void {
    this.bus.emit(
      "interaction",
      event.targetId
        ? { type, targetId: event.targetId, pointer: event.pointer }
        : { type, pointer: event.pointer },
    );
  }

  private runtimeFor(hand: Handedness): HandRuntime {
    const existing = this.hands.get(hand);
    if (existing) return existing;
    const runtime: HandRuntime = {
      smoother: new HandSmoother(hand, this.settings),
      machine: new GestureStateMachine(this.settings),
      snap: new SnapGestureRecognizer(this.snapSettings),
      pointer: null,
      hoveredTargetId: null,
      lastTargetId: null,
      lastFrameMs: 0,
      closestRatio: 1,
      closestAtMs: 0,
    };
    this.hands.set(hand, runtime);
    return runtime;
  }
}
