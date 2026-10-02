import type { LocalizedText } from "@/shared/contracts/locale";
import { format, message } from "@/i18n/text";

export type Capabilities = Readonly<{
  secureContext: boolean;
  getUserMedia: boolean;
  webgl2: boolean;
  webgpu: boolean;
  webxrImmersiveVr: boolean;
  offscreenCanvas: boolean;
  imageBitmap: boolean;
  videoFrameCallback: boolean;
  workers: boolean;
  wasmSimd: boolean;
}>;

const hasWebGl2 = (): boolean => {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgl2") !== null;
  } catch {
    return false;
  }
};

/** Detects SIMD support the same way the MediaPipe WASM loader does. */
const hasWasmSimd = (): boolean => {
  try {
    return WebAssembly.validate(
      new Uint8Array([
        0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
        253, 98, 11,
      ]),
    );
  } catch {
    return false;
  }
};

export const detectCapabilities = async (): Promise<Capabilities> => {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const xr = (nav as Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } })?.xr;

  let webxrImmersiveVr = false;
  if (xr) {
    try {
      webxrImmersiveVr = await xr.isSessionSupported("immersive-vr");
    } catch {
      webxrImmersiveVr = false;
    }
  }

  return {
    secureContext: typeof window !== "undefined" && window.isSecureContext,
    getUserMedia: Boolean(nav?.mediaDevices?.getUserMedia),
    webgl2: hasWebGl2(),
    webgpu: typeof navigator !== "undefined" && "gpu" in navigator,
    webxrImmersiveVr,
    offscreenCanvas: typeof OffscreenCanvas !== "undefined",
    imageBitmap: typeof createImageBitmap === "function",
    videoFrameCallback:
      typeof HTMLVideoElement !== "undefined" && "requestVideoFrameCallback" in HTMLVideoElement.prototype,
    workers: typeof Worker !== "undefined",
    wasmSimd: hasWasmSimd(),
  };
};

export type CapabilityBlocker = Readonly<{ id: string; message: LocalizedText }>;

/** Blockers stop the runtime; everything else degrades to a fallback path. */
export const findBlockers = (capabilities: Capabilities): readonly CapabilityBlocker[] => {
  const blockers: CapabilityBlocker[] = [];
  if (!capabilities.secureContext) {
    const host = typeof location !== "undefined" && location.host ? location.host : "localhost:5173";
    blockers.push({
      id: "secure-context",
      message: format(message("capability.secureContext"), { url: `https://${host}` }),
    });
  }
  if (!capabilities.getUserMedia) {
    blockers.push({ id: "get-user-media", message: message("capability.getUserMedia") });
  }
  if (!capabilities.webgl2) {
    blockers.push({ id: "webgl2", message: message("capability.webgl2") });
  }
  return blockers;
};
