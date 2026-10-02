/**
 * Canonical vision contracts shared by VR Core and every feature module.
 *
 * All rectangles/points are normalised image coordinates in `0..1`, expressed in
 * the analysis image space *before* mirror and rotation are applied. Only
 * `CoordinateMapper` is allowed to convert them into viewport or eye space.
 */
import type { LocalizedText } from "./locale";

export type NormalizedRect = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type NormalizedPoint = Readonly<{ x: number; y: number }>;

export type FrameRotation = 0 | 90 | 180 | 270;

/**
 * A single camera frame handed to consumers. `image` ownership is transferred to
 * workers, so a consumer must never keep a reference after `process()` resolves.
 */
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
  /** 0..1 */
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

/**
 * A manifest describes capability and cost, never appearance: the interface is
 * a single colour owned by Core, so modules declare no styling.
 */
export type ModuleManifest = Readonly<{
  id: string;
  version: string;
  /** Written in every language the app speaks; a plugin translates its own. */
  displayName: LocalizedText;
  description: LocalizedText;
  input: Readonly<{ preferredFps: number; maxWidth?: number; maxHeight?: number }>;
  outputKinds: readonly string[];
  execution: ModuleExecution;
  permissions: readonly ModulePermission[];
}>;

export type ModuleState = "idle" | "loading" | "ready" | "paused" | "failed";
