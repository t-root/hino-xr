import type { ModuleManifest } from "@/shared/contracts/vision";
import text from "./text.json";

export const map3dManifest: ModuleManifest = {
  id: "map3d",
  version: "2.0.0",
  displayName: text.displayName,
  description: text.description,
  input: { preferredFps: 1, maxWidth: 32, maxHeight: 32 },
  outputKinds: ["map"],
  execution: "main",
  permissions: ["camera-frame", "network", "screen"],
};
