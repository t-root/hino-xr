import type { ModuleManifest } from "@/shared/contracts/vision";
import text from "./text.json";

export const objectDetectionManifest: ModuleManifest = {
  id: "object-detection",
  version: "1.0.0",
  displayName: text.displayName,
  description: text.description,
  // EfficientDet-Lite0 looks at 320×320 anyway; a bigger frame is only more to copy.
  // Things on a table move slowly, so a lower rate than faces is enough.
  input: { preferredFps: 8, maxWidth: 320, maxHeight: 320 },
  outputKinds: ["object"],
  execution: "worker",
  permissions: ["camera-frame"],
};
