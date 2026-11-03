/// <reference lib="webworker" />
import { FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";
import type { WorkerInitPayload, WorkerRequest, WorkerResponse } from "@/core/workers/protocol";
import { toObjectDetections, type RawDetection } from "./mapping";

/**
 * Object detection, off the main thread: bitmap in, normalised detections out.
 * It knows nothing about the DOM, the camera, the renderer or the language.
 */
let detector: ObjectDetector | null = null;
let options: WorkerInitPayload | null = null;
let lastTimestamp = 0;

const post = (message: WorkerResponse): void => {
  self.postMessage(message);
};

const numberOption = (payload: WorkerInitPayload, key: string, fallback: number): number => {
  const value = payload.options?.[key];
  return typeof value === "number" ? value : fallback;
};

const stringsOption = (payload: WorkerInitPayload, key: string): string[] => {
  const value = payload.options?.[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
};

/**
 * CPU only. The model is the quantised (int8) EfficientDet-Lite0, which runs at a
 * usable rate on a phone's CPU. The GPU delegate loads it without complaint and then
 * answers wrongly: a photo of a cat and a dog came back as a boat at 0.11, and the
 * first frame took 26 seconds to compile. On the CPU the same photo gives dog 0.88 and
 * cat 0.80 in about 300 ms, so there is no GPU attempt to fall back from.
 */
const createDetector = async (payload: WorkerInitPayload): Promise<ObjectDetector> => {
  const fileset = await FilesetResolver.forVisionTasks(payload.wasmBase);
  return ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: payload.modelUrl, delegate: "CPU" },
    runningMode: "VIDEO",
    scoreThreshold: payload.scoreThreshold,
    maxResults: numberOption(payload, "maxResults", 10),
    categoryDenylist: stringsOption(payload, "deniedCategories"),
  });
};

const initialize = async (payload: WorkerInitPayload): Promise<void> => {
  try {
    options = payload;
    detector = await createDetector(payload);
    post({ type: "ready" });
  } catch (error) {
    post({ type: "init-failed", message: (error as Error).message });
  }
};

const infer = (request: Extract<WorkerRequest, { type: "infer" }>): void => {
  const image = request.image;
  if (!detector || !options) {
    image.close();
    post({ type: "error", requestId: request.requestId, message: "detector not initialised" });
    return;
  }

  try {
    // MediaPipe video mode rejects a timestamp that does not move forward.
    const timestamp = Math.max(Math.round(request.timestampMs), lastTimestamp + 1);
    lastTimestamp = timestamp;
    const result = detector.detectForVideo(image, timestamp);

    const detections = toObjectDetections(result.detections as readonly RawDetection[], {
      imageWidth: image.width,
      imageHeight: image.height,
      minConfidence: options.scoreThreshold,
      maxResults: numberOption(options, "maxResults", 10),
    });

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
      infer(request);
      break;
    case "dispose":
      detector?.close();
      detector = null;
      break;
  }
});
