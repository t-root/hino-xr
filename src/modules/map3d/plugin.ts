import { definePlugin } from "@/core/modules/definePlugin";
import { map3dManifest } from "./manifest";

export default definePlugin({
  manifest: map3dManifest,
  load: async () => {
    const { createMap3dModule } = await import("./Map3dModule");
    return createMap3dModule();
  },
});
