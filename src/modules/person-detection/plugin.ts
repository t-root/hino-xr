import { definePlugin } from "@/core/modules/definePlugin";
import { personDetectionManifest } from "./manifest";

export default definePlugin({
  manifest: personDetectionManifest,
  load: async () => {
    const { createPersonDetectionModule } = await import("./PersonDetectionModule");
    return createPersonDetectionModule();
  },
});
