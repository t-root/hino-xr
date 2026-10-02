import type { ModuleManifest } from "@/shared/contracts/vision";
import text from "./text.json";

export const personDetectionManifest: ModuleManifest = {
  id: "person-detection",
  version: "1.2.0",
  displayName: text.displayName,
  description: text.description,
  input: { preferredFps: 10, maxWidth: 512, maxHeight: 512 },
  outputKinds: ["person"],
  execution: "worker",
  permissions: ["camera-frame"],
};
