import type { Detection, FrameRotation } from "@/shared/contracts/vision";

export type WorkerInitPayload = Readonly<{
  wasmBase: string;
  modelUrl: string;
  scoreThreshold: number;
  options?: Readonly<Record<string, unknown>>;
}>;

export type WorkerRequest =
  | Readonly<{ type: "init"; payload: WorkerInitPayload }>
  | Readonly<{
      type: "infer";
      requestId: number;
      frameId: number;
      timestampMs: number;
      rotationDeg: FrameRotation;
      mirrored: boolean;
      image: ImageBitmap;
    }>
  | Readonly<{ type: "dispose" }>;

export type WorkerResponse =
  | Readonly<{ type: "ready" }>
  | Readonly<{ type: "init-failed"; message: string }>
  | Readonly<{ type: "result"; requestId: number; frameId: number; detections: readonly Detection[] }>
  | Readonly<{ type: "error"; requestId: number; message: string }>;
