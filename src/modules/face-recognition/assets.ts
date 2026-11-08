import { pluginModelUrl } from "@/core/modules/plugin-models";
import { faceRecognitionManifest } from "./manifest";
import spec from "./models.json";

const urlOf = (file: string): string => {
  if (!spec.files.some((item) => item.file === file)) throw new Error(`models.json does not declare ${file}`);
  return pluginModelUrl(faceRecognitionManifest.id, file);
};

/** Finds where the faces are (and their eyes, nose and mouth, which line each one up). */
export const FACE_MODEL_URL = urlOf("blaze_face_short_range.tflite");

/** Turns one lined-up face into 128 numbers; faces of one person give numbers that are close. */
export const EMBEDDING_MODEL_URL = urlOf("face_recognition_sface_2021dec.onnx");

/** The ONNX runtime the embedding model runs on: its script, and the folder its other two files sit in. */
export const ORT_SCRIPT_URL = urlOf("ort.wasm.min.js");
export const ORT_BASE_URL = ORT_SCRIPT_URL.slice(0, ORT_SCRIPT_URL.lastIndexOf("/") + 1);
// Declared so they are fetched and served; the runtime asks for them by name next to its script.
urlOf("ort-wasm-simd-threaded.mjs");
urlOf("ort-wasm-simd-threaded.wasm");
