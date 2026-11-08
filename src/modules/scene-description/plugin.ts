import { definePlugin } from "@/core/modules/definePlugin";
import { sceneDescriptionManifest } from "./manifest";

export default definePlugin({
  manifest: sceneDescriptionManifest,
  load: async () => {
    const { createSceneDescriptionModule } = await import("./SceneDescriptionModule");
    return createSceneDescriptionModule();
  },
});
