import { pluginModelUrl } from "@/core/modules/plugin-models";
import { faceRecognitionManifest } from "./manifest";
import spec from "./models.json";

const urlOf = (file: string): string => {
  if (!spec.files.some((item) => item.file === file)) throw new Error(`models.json does not declare ${file}`);
  return pluginModelUrl(faceRecognitionManifest.id, file);
};

export const FACE_MODEL_URL = urlOf("blaze_face_short_range.tflite");

export const EMBEDDING_MODEL_URL = urlOf("face_recognition_sface_2021dec.onnx");

export const ORT_SCRIPT_URL = urlOf("ort.wasm.min.js");
export const ORT_BASE_URL = ORT_SCRIPT_URL.slice(0, ORT_SCRIPT_URL.lastIndexOf("/") + 1);
urlOf("ort-wasm-simd-threaded.mjs");
urlOf("ort-wasm-simd-threaded.wasm");
