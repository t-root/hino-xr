/// <reference lib="webworker" />
import { FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";
import type { WorkerInitPayload, WorkerRequest, WorkerResponse } from "@/core/workers/protocol";
import { toPersonDetections, type RawDetection } from "./mapping";

/**
 * Person detection, off the main thread. It knows nothing about the DOM, the
 * camera or the renderer: bitmap in, normalised detections out.
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

const categoriesOption = (payload: WorkerInitPayload): readonly string[] => {
  const value = payload.options?.allowedCategories;
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
};

/**
 * GPU first, then CPU. The GPU delegate is a large win where it works and a
 * hard failure where the driver is blocked, and a plugin that refuses to start
 * on such a device is worse than one that runs slower on it.
 */
const createDetector = async (payload: WorkerInitPayload): Promise<ObjectDetector> => {
  const fileset = await FilesetResolver.forVisionTasks(payload.wasmBase);
  let lastError: unknown;
  for (const delegate of ["GPU", "CPU"] as const) {
    try {
      return await ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: payload.modelUrl, delegate },
        runningMode: "VIDEO",
        scoreThreshold: payload.scoreThreshold,
        maxResults: numberOption(payload, "maxResults", 12),
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("object detector failed to start");
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

    const detections = toPersonDetections(result.detections as readonly RawDetection[], {
      imageWidth: image.width,
      imageHeight: image.height,
      minConfidence: options.scoreThreshold,
      allowedCategories: categoriesOption(options),
      maxResults: numberOption(options, "maxResults", 12),
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
