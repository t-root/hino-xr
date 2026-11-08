import type { ModuleManifest } from "@/shared/contracts/vision";
import text from "./text.json";

export const faceRecognitionManifest: ModuleManifest = {
  id: "face-recognition",
  version: "2.0.0",
  displayName: text.displayName,
  description: text.description,
  // Working out whose face it is costs more than finding it, so frames come less often than for a bare detector.
  input: { preferredFps: 8, maxWidth: 384, maxHeight: 384 },
  outputKinds: ["face"],
  execution: "worker",
  // `network`: the people it knows are kept by the model server (permissions.ts); `screen`: its own list and form.
  permissions: ["camera-frame", "network", "screen"],
};
