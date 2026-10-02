import { definePlugin } from "@/core/modules/definePlugin";
import { objectDetectionManifest } from "./manifest";

export default definePlugin({
  manifest: objectDetectionManifest,
  load: async () => {
    const { createObjectDetectionModule } = await import("./ObjectDetectionModule");
    return createObjectDetectionModule();
  },
});
