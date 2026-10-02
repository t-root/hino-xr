import { ASSETS } from "@/core/config";
import { createDetectorModule } from "@/core/modules/DetectorModule";
import type { VisionModule } from "@/core/modules/module-contract";
import { spawnInferenceWorker } from "@/core/workers/spawn";
import { FACE_MODEL_URL } from "./assets";
import { faceDetectionManifest } from "./manifest";
import text from "./text.json";

/**
 * Lower than the person detector on purpose: a face half turned away still
 * scores well below a face straight on, and dropping those is worse than
 * drawing a box that flickers for a moment.
 */
const MIN_CONFIDENCE = 0.4;

/** A room with more faces than this is not what a headset overlay is for. */
const MAX_RESULTS = 8;

/**
 * Local face detection: where the faces are, not whose they are.
 *
 * Identifying people is a different plugin and a different conversation — it
 * needs stored face data, which is the one thing this one never keeps.
 */
export const createFaceDetectionModule = (): VisionModule =>
  createDetectorModule({
    manifest: faceDetectionManifest,
    createWorker: () => spawnInferenceWorker("modules/face-detection/face.worker.ts"),
    init: {
      wasmBase: ASSETS.wasmBase,
      modelUrl: FACE_MODEL_URL,
      scoreThreshold: MIN_CONFIDENCE,
      options: { maxResults: MAX_RESULTS },
    },
    label: (locale) => text.label[locale],
    // Faces leave the frame and come back constantly, so an id is held a little
    // longer than a body's before it is given up.
    maxMissedFrames: 10,
  });
