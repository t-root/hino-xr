import { definePlugin } from "@/core/modules/definePlugin";
import { codeReaderManifest } from "./manifest";

export default definePlugin({
  manifest: codeReaderManifest,
  load: async () => {
    const { createCodeReaderModule } = await import("./CodeReaderModule");
    return createCodeReaderModule();
  },
});
