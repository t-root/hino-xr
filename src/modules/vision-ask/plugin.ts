import { definePlugin } from "@/core/modules/definePlugin";
import { visionAskManifest } from "./manifest";

export default definePlugin({
  manifest: visionAskManifest,
  load: async () => {
    const { createVisionAskModule } = await import("./VisionAskModule");
    return createVisionAskModule();
  },
});
