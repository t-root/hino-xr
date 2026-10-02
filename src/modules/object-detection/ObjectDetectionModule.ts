import { ASSETS } from "@/core/config";
import { createDetectorModule } from "@/core/modules/DetectorModule";
import type { VisionModule } from "@/core/modules/module-contract";
import { spawnInferenceWorker } from "@/core/workers/spawn";
import type { Locale, LocalizedText } from "@/shared/contracts/locale";
import { OBJECT_MODEL_URL } from "./assets";
import { objectDetectionManifest } from "./manifest";
import text from "./text.json";

/**
 * A small quantised model is unsure more often than a big one; below this its
 * guesses are mostly shadows and reflections.
 */
const MIN_CONFIDENCE = 0.4;

/** A table with more labelled things than this is unreadable through a lens. */
const MAX_RESULTS = 10;

/**
 * People are what the person plugin is for: with both on, one person would
 * otherwise wear two boxes.
 */
const DENIED_CATEGORIES = ["person"];

const classes = text as unknown as Readonly<Record<string, LocalizedText | undefined>>;

/** The model's class name in the interface's language; the raw name if it is new. */
const nameOf = (kind: string, locale: Locale): string =>
  classes[`class.${kind}`]?.[locale] ?? text.label[locale];

/**
 * Local object detection: about eighty everyday classes (COCO), each box named
 * after what it holds. Model, thresholds and names all live in this folder.
 */
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
    // Objects stay put; a box held through a few missed frames flickers less.
    maxMissedFrames: 8,
  });
