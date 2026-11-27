import type { LocalizedText } from "./locale";

export type NormalizedRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type NormalizedPoint = Readonly<{ x: number; y: number }>;

export type FrameRotation = 0 | 90 | 180 | 270;

export type FramePacket = Readonly<{
  id: number;
  timestampMs: number;
  image: ImageBitmap;
  width: number;
  height: number;
  rotationDeg: FrameRotation;
  mirrored: boolean;
}>;

type DetectionKind = "person" | "plate" | "text" | "face" | "object" | (string & {});

export type Detection = Readonly<{
  id: string;
  kind: DetectionKind;
  bounds: NormalizedRect;
  confidence: number;
  label?: string;
  attributes?: Readonly<Record<string, string | number | boolean>>;
  interaction?: Readonly<{
    selectable?: boolean;
    draggable?: boolean;
    detailAction?: string;
  }>;
}>;

export type DetectionBatch = Readonly<{
  moduleId: string;
  sourceFrameId: number;
  producedAtMs: number;
  detections: readonly Detection[];
}>;

export type ModulePermission = "camera-frame" | "network" | "snapshot" | "screen";

type ModuleExecution = "worker" | "main" | "remote";

export type ModuleManifest = Readonly<{
  id: string;
  version: string;
  displayName: LocalizedText;
  description: LocalizedText;
  input: Readonly<{ preferredFps: number; maxWidth?: number; maxHeight?: number }>;
  outputKinds: readonly string[];
  execution: ModuleExecution;
  permissions: readonly ModulePermission[];
}>;

export type ModuleState = "idle" | "loading" | "ready" | "paused" | "failed";
