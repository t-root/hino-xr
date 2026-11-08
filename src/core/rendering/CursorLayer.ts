import type { Handedness } from "@/shared/contracts/input";
import { clamp01 } from "@/shared/math/num";
import type { NormalizedPoint } from "@/shared/contracts/vision";
import { useCursorStore, type CursorMark, type CursorPhase } from "../state/CursorStore";
import type { CoordinateMapper } from "./CoordinateMapper";

export type { CursorPhase };

export type CursorVisual = Readonly<{
  hand: Handedness;
  /** Display-space position, `0..1`. */
  point: NormalizedPoint;
  phase: CursorPhase;
  /** How far a held pinch has got towards becoming a drag, `0..1`. */
  holdProgress: number;
  confidence: number;
}>;

/** A cursor is this share of the eye's height, before the wearer's size setting. */
const UNIT = 0.022;

/**
 * Hand cursors, handed to the one thing that draws them: `CursorOverlay`, a DOM layer above everything in each
 * eye. They used to be meshes in the 3D scene, which every panel of the interface covered; a cursor you cannot see
 * is a hand you cannot aim.
 */
export class CursorLayer {
  constructor(
    private readonly mapper: CoordinateMapper,
    private readonly cursorOpacity: () => number,
    private readonly cursorScale: () => number,
  ) {}

  /** Marks a press that landed on something, at the hand that made it. */
  flash(hand: Handedness, nowMs: number): void {
    useCursorStore.getState().flash(hand, nowMs);
  }

  update(visuals: readonly CursorVisual[], nowMs: number): void {
    const marks: CursorMark[] = visuals.map((visual) => {
      const ndc = this.mapper.displayToNdc(visual.point);
      return {
        hand: visual.hand,
        x: (ndc.x + 1) / 2,
        y: (1 - ndc.y) / 2,
        phase: visual.phase,
        progress: clamp01(visual.holdProgress),
        confidence: visual.confidence,
      };
    });
    useCursorStore.getState().publish({
      marks,
      unit: UNIT * Math.max(this.cursorScale(), 0.15),
      alpha: clamp01(this.cursorOpacity()),
      nowMs,
    });
  }

  dispose(): void {
    useCursorStore.getState().clear();
  }
}
