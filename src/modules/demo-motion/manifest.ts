import type { ModuleManifest } from "@/shared/contracts/vision";
import text from "./text.json";

export const demoMotionManifest: ModuleManifest = {
  id: "demo-motion",
  version: "1.1.0",
  displayName: text.displayName,
  description: text.description,
  input: { preferredFps: 12 },
  outputKinds: ["object"],
  execution: "main",
  permissions: ["camera-frame"],
};
