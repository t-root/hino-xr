/// <reference lib="webworker" />
import type { WorkerInitPayload, WorkerRequest, WorkerResponse } from "@/core/workers/protocol";
import { toCodeDetections, type RawCode } from "./mapping";

/**
 * Reads QR codes and barcodes, off the main thread: bitmap in, boxes with the decoded text out.
 * The decoder is a plain script that sets the global `ZXingWASM`; its compiled core is fetched from the
 * plugin's own folder (`locateFile`), never from a CDN.
 */
declare const ZXingWASM: {
  prepareZXingModule(options: { overrides: { locateFile: (path: string, prefix: string) => string }; fireImmediately: true }): Promise<unknown>;
  readBarcodes(image: ImageData, options: { tryHarder: boolean; maxNumberOfSymbols: number }): Promise<RawCode[]>;
};
declare function importScripts(...urls: string[]): void;

let canvas: OffscreenCanvas | null = null;
let options: WorkerInitPayload | null = null;

const post = (message: WorkerResponse): void => {
  self.postMessage(message);
};

const numberOption = (payload: WorkerInitPayload, key: string, fallback: number): number => {
  const value = payload.options?.[key];
  return typeof value === "number" ? value : fallback;
};

const initialize = async (payload: WorkerInitPayload): Promise<void> => {
  try {
    options = payload;
    const script = payload.options?.scriptUrl;
    if (typeof script !== "string" || script === "") throw new Error("worker option scriptUrl is missing");
    importScripts(script);
    await ZXingWASM.prepareZXingModule({
      overrides: { locateFile: (path, prefix) => (path.endsWith(".wasm") ? payload.modelUrl : prefix + path) },
      fireImmediately: true,
    });
    post({ type: "ready" });
  } catch (error) {
    post({ type: "init-failed", message: (error as Error).message });
  }
};

const infer = async (request: Extract<WorkerRequest, { type: "infer" }>): Promise<void> => {
  const image = request.image;
  if (!options) {
    image.close();
    post({ type: "error", requestId: request.requestId, message: "reader not initialised" });
    return;
  }
  try {
    if (!canvas || canvas.width !== image.width || canvas.height !== image.height) {
      canvas = new OffscreenCanvas(image.width, image.height);
    }
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("no 2d context");
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height);
    const maxResults = numberOption(options, "maxResults", 4);
    const found = await ZXingWASM.readBarcodes(pixels, { tryHarder: true, maxNumberOfSymbols: maxResults });
    const detections = toCodeDetections(found, { imageWidth: image.width, imageHeight: image.height, maxResults });
    post({ type: "result", requestId: request.requestId, frameId: request.frameId, detections });
  } catch (error) {
    post({ type: "error", requestId: request.requestId, message: (error as Error).message });
  } finally {
    image.close();
  }
};

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  switch (request.type) {
    case "init":
      void initialize(request.payload);
      break;
    case "infer":
      void infer(request);
      break;
    case "dispose":
      canvas = null;
      break;
  }
});
