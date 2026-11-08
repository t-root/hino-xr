import type { ModuleManifest } from "@/shared/contracts/vision";
import text from "./text.json";

export const sceneDescriptionManifest: ModuleManifest = {
  id: "scene-description",
  version: "1.0.0",
  displayName: text.displayName,
  description: text.description,
  // Counting what is in view needs no more than a few looks a second at the size the model sees.
  input: { preferredFps: 3, maxWidth: 320, maxHeight: 320 },
  outputKinds: ["object"],
  execution: "worker",
  permissions: ["camera-frame"],
};
