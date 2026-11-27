import { ASSETS } from "@/core/config";
import { createDetectorModule } from "@/core/modules/DetectorModule";
import type { VisionModule } from "@/core/modules/module-contract";
import { spawnInferenceWorker } from "@/core/workers/spawn";
import { PERSON_MODEL_URL } from "./assets";
import { personDetectionManifest } from "./manifest";
import text from "./text.json";

const MIN_CONFIDENCE = 0.45;

const MAX_RESULTS = 12;

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
