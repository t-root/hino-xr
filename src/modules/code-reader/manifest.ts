import type { ModuleManifest } from "@/shared/contracts/vision";
import text from "./text.json";

export const codeReaderManifest: ModuleManifest = {
  id: "code-reader",
  version: "1.0.0",
  displayName: text.displayName,
  description: text.description,
  // A code is read from its dark and light squares, so it needs more pixels than an object does, and it does not move fast.
  input: { preferredFps: 4, maxWidth: 640, maxHeight: 640 },
  outputKinds: ["code"],
  execution: "worker",
  permissions: ["camera-frame"],
};
