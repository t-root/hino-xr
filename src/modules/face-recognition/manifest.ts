import type { ModuleManifest } from "@/shared/contracts/vision";
import text from "./text.json";

export const faceRecognitionManifest: ModuleManifest = {
  id: "face-recognition",
  version: "2.0.0",
  displayName: text.displayName,
  description: text.description,
  input: { preferredFps: 8, maxWidth: 384, maxHeight: 384 },
  outputKinds: ["face"],
  execution: "worker",
  permissions: ["camera-frame", "network", "screen"],
};
