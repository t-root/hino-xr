import { definePlugin } from "@/core/modules/definePlugin";
import { faceDetectionManifest } from "./manifest";

export default definePlugin({
  manifest: faceDetectionManifest,
  load: async () => {
    const { createFaceDetectionModule } = await import("./FaceDetectionModule");
    return createFaceDetectionModule();
  },
});
