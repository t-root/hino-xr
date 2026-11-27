import { ENV } from "@/env";

const base = ENV.BASE_URL;

export const ASSETS = {
  wasmBase: `${base}mediapipe/wasm`,
  handLandmarker: `${base}models/hand_landmarker.task`,
} as const;

export const MODEL_API = `${base}api/models`;
