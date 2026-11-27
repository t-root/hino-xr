import { createStore } from "zustand/vanilla";
import type { Handedness } from "@/shared/contracts/input";

export type CursorPhase = "tracking" | "hover" | "pinching" | "dragging";

export type CursorMark = Readonly<{
  hand: Handedness;
  x: number;
  y: number;
  phase: CursorPhase;
  progress: number;
  confidence: number;
}>;

type CursorFrame = Readonly<{
  marks: readonly CursorMark[];
  flashes: Readonly<Partial<Record<Handedness, number>>>;
  unit: number;
  alpha: number;
  nowMs: number;
}>;

type CursorState = CursorFrame & {
  publish: (frame: Omit<CursorFrame, "flashes">) => void;
  flash: (hand: Handedness, nowMs: number) => void;
  clear: () => void;
};

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
