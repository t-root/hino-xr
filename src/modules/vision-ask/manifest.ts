import type { ModuleManifest } from "@/shared/contracts/vision";
import text from "./text.json";

export const visionAskManifest: ModuleManifest = {
  id: "vision-ask",
  version: "1.0.0",
  displayName: text.displayName,
  description: text.description,
  // No boxes are drawn: the plugin only keeps the latest still so that a spoken question has a picture to look at.
  // One a second, no larger than a picture model reads well.
  input: { preferredFps: 1, maxWidth: 640, maxHeight: 640 },
  outputKinds: ["answer"],
  execution: "main",
  // `network`: the still goes to the model server (this computer) and, if the wearer chose the API, on to SiliconFlow.
  // `snapshot`: it keeps that still after the frame it came from is gone. Both are granted in permissions.ts.
  permissions: ["camera-frame", "network", "snapshot"],
};
