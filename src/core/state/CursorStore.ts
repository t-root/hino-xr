import { createStore } from "zustand/vanilla";
import type { Handedness } from "@/shared/contracts/input";

export type CursorPhase = "tracking" | "hover" | "pinching" | "dragging";

/** One hand's cursor for one frame, positioned as a share of the eye (0..1 from its top left corner). */
export type CursorMark = Readonly<{
  hand: Handedness;
  x: number;
  y: number;
  phase: CursorPhase;
  /** How far a held pinch has got towards becoming a drag, 0..1. */
  progress: number;
  confidence: number;
}>;

type CursorFrame = Readonly<{
  marks: readonly CursorMark[];
  /** When each hand's last press landed, ms; the burst plays from there. */
  flashes: Readonly<Partial<Record<Handedness, number>>>;
  /** Half-size of a cursor as a share of the eye's height. */
  unit: number;
  alpha: number;
  nowMs: number;
}>;

type CursorState = CursorFrame & {
  publish: (frame: Omit<CursorFrame, "flashes">) => void;
  flash: (hand: Handedness, nowMs: number) => void;
  clear: () => void;
};

/**
 * Where the hand cursors are, written once a frame and drawn by every eye's `CursorOverlay`.
 *
 * Held here, not in the scene, because the cursor must be drawn above everything else on screen and nothing in
 * the 3D scene can be above the interface (rules.md A1).
 */
export const useCursorStore = createStore<CursorState>((set) => ({
  marks: [],
  flashes: {},
  unit: 0.022,
  alpha: 1,
  nowMs: 0,
  publish: (frame) => set(frame),
  flash: (hand, nowMs) => set((state) => ({ flashes: { ...state.flashes, [hand]: nowMs } })),
  clear: () => set({ marks: [] }),
}));
