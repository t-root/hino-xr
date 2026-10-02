import type { ModuleManifest } from "@/shared/contracts/vision";
import text from "./text.json";

export const faceDetectionManifest: ModuleManifest = {
  id: "face-detection",
  version: "1.1.0",
  displayName: text.displayName,
  description: text.description,
  // Faces move faster than bodies, and the model is small enough to keep up.
  input: { preferredFps: 12, maxWidth: 384, maxHeight: 384 },
  outputKinds: ["face"],
  execution: "worker",
  permissions: ["camera-frame"],
};
