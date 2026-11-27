import type { ModuleManifest } from "@/shared/contracts/vision";
import text from "./text.json";

export const spaceScannerManifest: ModuleManifest = {
  id: "space-scanner",
  version: "0.1.0",
  displayName: text.displayName,
  description: text.description,
  input: {
    preferredFps: 12,
    maxWidth: 256,
    maxHeight: 256,
  },
  outputKinds: ["region"],
  execution: "main",
  permissions: ["camera-frame", "network", "screen"],
};
