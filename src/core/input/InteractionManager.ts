import type { GestureEvent, HandFrame, HandPointer, Handedness } from "@/shared/contracts/input";
import type { EventBus } from "../events/EventBus";
import type { RuntimeEvents } from "../events/events";
import type { CursorLayer, CursorPhase, CursorVisual } from "../rendering/CursorLayer";
import type { GestureState } from "./GestureStateMachine";
import type { GestureSettings, SnapSettings } from "../state/settings";
import type { PointerSurface } from "./DomPointerSurface";
import { extractSignals } from "./GestureRecognizer";
import { GestureStateMachine } from "./GestureStateMachine";
import { HandSmoother } from "./HandSmoother";
import type { HitTestService } from "./HitTestService";
import type { InteractiveRegistry } from "./InteractiveRegistry";
import { SnapGestureRecognizer, type SnapState } from "./SnapGestureRecognizer";

/** What the cursor should look like for a hand in this state. */
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
  /** What the hit-test found this frame, before any dwell or capture rule. */
  lastTargetId: string | null;
  lastFrameMs: number;
  closestRatio: number;
  closestAtMs: number;
};

/**
 * What one hand is doing right now, in numbers, for the diagnostics panel.
 *
 * A gesture that does not fire looks the same as a hand the tracker never saw,
 * and neither leaves anything behind to read afterwards. These are the figures
 * that tell the two apart, so "it does not work" can be answered with how close
 * the fingers actually came and what they were pointing at.
 */
export type HandProbe = Readonly<{
  hand: Handedness;
  state: GestureState;
  /** Gap between thumb and index tips, as a share of hand size. */
  pinchRatio: number;
  /** The smallest that gap has been in the last second. */
  closestRatio: number;
  /** A pinch starts below this. */
  enterRatio: number;
  /** A pinch lets go above this, right now. */
  exitRatio: number;
  /** What the hand is pointing at, in words; null when it is over nothing. */
  target: string | null;
  snapState: SnapState;
  thumbMiddleRatio: number;
  middleCurlRatio: number;
}>;

/** How far back `closestRatio` looks: long enough to catch an attempt, ms. */
const CLOSEST_WINDOW_MS = 1000;

/**
 * Owns every gesture a hand can make, and pointer routing with it: hit-testing,
 * capture during a drag, hover bookkeeping, and the single-owner rule that
 * stops two hands from driving one target.
 *
 * Recognition lives here rather than at each place that wants a gesture, so
 * there is one answer to "was that a click, a drag or a snap" and everything
 * downstream reads the same one off the bus. Interaction itself goes through
 * here rather than through the bus so ordering and capture are guaranteed; the
 * bus only mirrors what happened.
 */
export class InteractionManager {
  private readonly hands = new Map<Handedness, HandRuntime>();
  private readonly ownerByTarget = new Map<string, Handedness>();
  private settings: GestureSettings;
  private snapSettings: SnapSettings;
  private snapEnabled: boolean;
  private selectedTargetId: string | null = null;

  constructor(
    private readonly bus: EventBus<RuntimeEvents>,
    private readonly registry: InteractiveRegistry,
    private readonly hitTest: HitTestService,
    private readonly cursors: CursorLayer,
    private readonly mapperDisplay: (point: { x: number; y: number }) => { x: number; y: number },
    settings: GestureSettings,
    snapSettings: SnapSettings,
    snapEnabled: boolean,
    /** The interface, when there is one. Absent in tests and headless runs. */
    private readonly surface: PointerSurface | null = null,
  ) {
    this.settings = settings;
    this.snapSettings = snapSettings;
    this.snapEnabled = snapEnabled;
  }

  setSettings(settings: GestureSettings, snapSettings: SnapSettings, snapEnabled: boolean): void {
    this.settings = settings;
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

  /** Live figures for every tracked hand; read by the diagnostics panel. */
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

  /** What a target is called, in words. Falls back to its id for scene targets. */
  describeTarget(targetId: string | null): string | null {
    if (!targetId) return null;
    return this.surface?.describe(targetId) ?? targetId;
  }

  /** True while the hand holds something; snap detection ignores busy hands. */
  isHandBusy(hand: Handedness): boolean {
    const state = this.hands.get(hand)?.machine.currentState;
    return state === "pinching" || state === "dragging";
  }

  /** Feeds the latest landmark result; called at hand tracking rate. */
  ingest(hands: readonly HandFrame[]): void {
    const pointers: HandPointer[] = [];
    for (const frame of hands) {
      const runtime = this.runtimeFor(frame.hand);
      runtime.lastFrameMs = frame.timestampMs;
      const pointer = runtime.smoother.update(frame);
      runtime.pointer = pointer;
      if (!pointer) continue;
      pointers.push(pointer);
      // Read at tracking rate, not at render rate: a snap is over in about
      // thirty milliseconds, so sampling it once per drawn frame would be
      // sampling a movement that has already finished.
      this.detectSnap(runtime, frame, pointer);
    }
    this.bus.emit("hand.tracked", { pointers, hands });
  }

  private detectSnap(runtime: HandRuntime, frame: HandFrame, pointer: HandPointer): void {
    if (!this.snapEnabled) return;
    const signals = extractSignals(frame);
    const snapped = runtime.snap.update({
      nowMs: frame.timestampMs,
      thumbMiddleRatio: signals.thumbMiddleRatio,
      middleCurlRatio: signals.middleCurlRatio,
      busy: this.isHandBusy(frame.hand),
    });
    // Announced like any other gesture rather than wired to one caller: a snap
    // aims at nothing in particular, so whoever wants it listens for it.
    if (snapped) this.dispatch(runtime, [{ type: "snap", hand: pointer.hand, pointer }], frame.timestampMs);
  }

  /** Called once per rendered frame so interaction latency tracks the display. */
  update(nowMs: number): void {
    const visuals: CursorVisual[] = [];

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

      const stale = nowMs - runtime.closestAtMs > CLOSEST_WINDOW_MS;
      if (stale || pointer.pinchStrength < runtime.closestRatio) {
        runtime.closestRatio = pointer.pinchStrength;
        runtime.closestAtMs = nowMs;
      }

      visuals.push({
        hand,
        point: this.mapperDisplay({ x: pointer.position.x, y: pointer.position.y }),
        phase: phaseOf(runtime.machine.currentState, runtime.hoveredTargetId !== null),
        holdProgress: runtime.machine.holdProgress(nowMs),
        confidence: pointer.confidence,
      });
    }

    this.cursors.update(visuals, nowMs);
  }

  private resolveTarget(hand: Handedness, pointer: HandPointer, captured: string | null): string | null {
    if (captured) return captured;
    // The interface is drawn over the scene, so it is also pressed before the
    // scene: what covers a thing is what the hand reaches first.
    const targetId =
      this.surface?.hit(pointer.position) ??
      this.hitTest.hit({ x: pointer.position.x, y: pointer.position.y })?.targetId ??
      null;
    if (!targetId) return null;
    const owner = this.ownerByTarget.get(targetId);
    // One hand owns a target at a time; the other hand simply sees no target.
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
          // The press landed. Said at the hand that made it, because a press
          // that did nothing and a press that worked otherwise look the same.
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

      // A disabled or vanished target must never receive an activation.
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
