import type { Handedness } from "@/shared/contracts/input";
import { clamp01 } from "@/shared/math/num";
import type { NormalizedPoint } from "@/shared/contracts/vision";
import { useCursorStore, type CursorMark, type CursorPhase } from "../state/CursorStore";
import { useSharedUiStore } from "../state/SharedUiStore";
import type { CoordinateMapper } from "./CoordinateMapper";
import { lensWarp } from "./LensWarp";

export type { CursorPhase };

export type CursorVisual = Readonly<{
  hand: Handedness;
  point: NormalizedPoint;
  phase: CursorPhase;
  holdProgress: number;
  confidence: number;
}>;

const UNIT = 0.022;

export class CursorLayer {
  constructor(
    private readonly mapper: CoordinateMapper,
    private readonly cursorOpacity: () => number,
    private readonly cursorScale: () => number,
  ) {}

  private eyeSpot(point: NormalizedPoint): NormalizedPoint {
    if (useSharedUiStore.getState().fillFrame) {
      const ndc = this.mapper.displayToNdc(point);
      return { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2 };
    }
    const frame = this.mapper.displayToFrame(point);
    const seen = lensWarp.seen(frame.x, frame.y);
    const box = this.mapper.frameInEye();
    return { x: box.x + seen.x * box.width, y: box.y + seen.y * box.height };
  }

  flash(hand: Handedness, nowMs: number): void {
    useCursorStore.getState().flash(hand, nowMs);
  }

  update(visuals: readonly CursorVisual[], nowMs: number): void {
    const marks: CursorMark[] = visuals.map((visual) => {
      const spot = this.eyeSpot(visual.point);
      return {
        hand: visual.hand,
        x: spot.x,
        y: spot.y,
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
