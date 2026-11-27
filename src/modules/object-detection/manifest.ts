import type { ModuleManifest } from "@/shared/contracts/vision";
import text from "./text.json";

export const objectDetectionManifest: ModuleManifest = {
  id: "object-detection",
  version: "1.0.0",
  displayName: text.displayName,
  description: text.description,
  input: { preferredFps: 3, maxWidth: 320, maxHeight: 320 },
  outputKinds: ["object"],
  execution: "worker",
  permissions: ["camera-frame"],
};
