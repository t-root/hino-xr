import { definePlugin } from "@/core/modules/definePlugin";
import { demoMotionManifest } from "./manifest";

export default definePlugin({
  manifest: demoMotionManifest,
  load: async () => {
    const { createDemoMotionModule } = await import("./DemoMotionModule");
    return createDemoMotionModule();
  },
});
