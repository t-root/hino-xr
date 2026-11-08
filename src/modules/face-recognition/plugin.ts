import { definePlugin } from "@/core/modules/definePlugin";
import { faceRecognitionManifest } from "./manifest";

export default definePlugin({
  manifest: faceRecognitionManifest,
  load: async () => {
    const { createFaceRecognitionModule } = await import("./FaceRecognitionModule");
    return createFaceRecognitionModule();
  },
});
