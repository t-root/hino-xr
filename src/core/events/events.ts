import type { GestureEvent, HandFrame, HandPointer, PointerPhase } from "@/shared/contracts/input";
import type { DetectionBatch, ModuleState } from "@/shared/contracts/vision";

export type CameraState = "idle" | "requesting" | "ready" | "stopped" | "error";

export type RuntimeEvents = {
  "camera.state": { state: CameraState; error?: Error; deviceLabel?: string };
  "frame.available": { frameId: number; timestampMs: number; width: number; height: number };
  "module.state": { moduleId: string; state: ModuleState; error?: Error };
  "detection.batch": DetectionBatch;
  "hand.tracked": { pointers: readonly HandPointer[]; hands: readonly HandFrame[] };
  "hand.lost": { reason: "timeout" | "low-confidence" };
  gesture: GestureEvent;
  interaction: { type: PointerPhase; targetId?: string; pointer: HandPointer };
  "render.metrics": { fps: number; frameMs: number; droppedFrames: number };
  "plugin.request": { pluginId: string; action: "enable" | "disable" | "configure" };
  diagnostic: { level: "debug" | "warn" | "error"; scope: string; message: string };
};
