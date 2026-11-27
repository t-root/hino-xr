import { ASSETS } from "@/core/config";
import { createDetectorModule } from "@/core/modules/DetectorModule";
import type { VisionModule } from "@/core/modules/module-contract";
import { spawnInferenceWorker } from "@/core/workers/spawn";
import type { Locale, LocalizedText } from "@/shared/contracts/locale";
import { OBJECT_MODEL_URL } from "./assets";
import { objectDetectionManifest } from "./manifest";
import text from "./text.json";

const MIN_CONFIDENCE = 0.4;

const MAX_RESULTS = 10;

const DENIED_CATEGORIES = ["person"];

const classes = text as unknown as Readonly<Record<string, LocalizedText | undefined>>;

const nameOf = (kind: string, locale: Locale): string =>
  classes[`class.${kind}`]?.[locale] ?? text.label[locale];

export const createObjectDetectionModule = (): VisionModule =>
  createDetectorModule({
    manifest: objectDetectionManifest,
    createWorker: () => spawnInferenceWorker("modules/object-detection/object.worker.ts"),
    init: {
      wasmBase: ASSETS.wasmBase,
      modelUrl: OBJECT_MODEL_URL,
      scoreThreshold: MIN_CONFIDENCE,
      options: { maxResults: MAX_RESULTS, deniedCategories: DENIED_CATEGORIES },
    },
    label: (locale, detection) => nameOf(detection.kind, locale),
    maxMissedFrames: 8,
  });
