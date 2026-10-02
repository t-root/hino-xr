/**
 * Core's own asset locations: the MediaPipe runtime, shared by anything that
 * uses it, and the hand model Core tracks with. A plugin's model is not listed
 * here — it belongs to the plugin's folder, so that adding one is not a change
 * to Core (see `definePlugin`).
 *
 * Everything is served from **this origin** by default, out of `public/`, where
 * Python puts it before a run. A headset is often on a phone with no
 * signal, and a runtime that needs a public CDN to start is a runtime that does
 * not start; serving our own copies also satisfies the rule that production
 * loads pinned, integrity-checked assets rather than whatever a CDN is handing
 * out today.
 */
import { ENV } from "@/env";

const base = ENV.BASE_URL;

export const ASSETS = {
  wasmBase: `${base}mediapipe/wasm`,
  handLandmarker: `${base}models/hand_landmarker.task`,
} as const;

/**
 * Core's language-model server, same origin as the page.
 *
 * The browser only posts chat messages or a WAV, and reads tokens plus speech.
 */
export const MODEL_API = `${base}api/models`;
