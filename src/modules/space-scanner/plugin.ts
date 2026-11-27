import { definePlugin } from "@/core/modules/definePlugin";
import { spaceScannerManifest } from "./manifest";

export default definePlugin({
  manifest: spaceScannerManifest,
  load: async () => {
    const { createSpaceScannerModule } = await import("./SpaceScannerModule");
    return createSpaceScannerModule();
  },
});
