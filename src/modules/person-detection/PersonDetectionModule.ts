import { ASSETS } from "@/core/config";
import { createDetectorModule } from "@/core/modules/DetectorModule";
import type { VisionModule } from "@/core/modules/module-contract";
import { spawnInferenceWorker } from "@/core/workers/spawn";
import { PERSON_MODEL_URL } from "./assets";
import { personDetectionManifest } from "./manifest";
import text from "./text.json";

/**
 * Below this the box is usually a chair or a coat stand. Set here rather than
 * in Core: how sure this model has to be is a property of this model.
 */
const MIN_CONFIDENCE = 0.45;

/** More people than this in frame and the overlay is unreadable anyway. */
const MAX_RESULTS = 12;

/**
 * Local person detection. Everything about it — model, thresholds, the label it
 * puts on a box — lives in this folder; Core only ever sees a `DetectionBatch`.
 */
export const createPersonDetectionModule = (): VisionModule =>
  createDetectorModule({
    manifest: personDetectionManifest,
    createWorker: () => spawnInferenceWorker("modules/person-detection/detection.worker.ts"),
    init: {
      wasmBase: ASSETS.wasmBase,
      modelUrl: PERSON_MODEL_URL,
      scoreThreshold: MIN_CONFIDENCE,
      options: { maxResults: MAX_RESULTS, allowedCategories: ["person"] },
    },
    label: (locale) => text.label[locale],
  });
