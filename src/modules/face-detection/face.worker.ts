/// <reference lib="webworker" />
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import type { WorkerInitPayload, WorkerRequest, WorkerResponse } from "@/core/workers/protocol";
import { toFaceDetections, type RawFaceDetection } from "./mapping";

/**
 * Face detection, off the main thread. Bitmap in, normalised boxes out: the
 * image is closed here and never stored, so nothing of a face outlives the
 * frame it arrived in.
 */
let detector: FaceDetector | null = null;
let options: WorkerInitPayload | null = null;
let lastTimestamp = 0;

const post = (message: WorkerResponse): void => {
  self.postMessage(message);
};

const numberOption = (payload: WorkerInitPayload, key: string, fallback: number): number => {
  const value = payload.options?.[key];
  return typeof value === "number" ? value : fallback;
};

/**
 * GPU first, then CPU. The GPU delegate is a large win where it works and a
 * hard failure where the driver is blocked, and a plugin that refuses to start
 * on such a device is worse than one that runs slower on it.
 */
const createDetector = async (payload: WorkerInitPayload): Promise<FaceDetector> => {
  const fileset = await FilesetResolver.forVisionTasks(payload.wasmBase);
  let lastError: unknown;
  for (const delegate of ["GPU", "CPU"] as const) {
    try {
      return await FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: payload.modelUrl, delegate },
        runningMode: "VIDEO",
        minDetectionConfidence: payload.scoreThreshold,
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("face detector failed to start");
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

    const detections = toFaceDetections(result.detections as readonly RawFaceDetection[], {
      imageWidth: image.width,
      imageHeight: image.height,
      minConfidence: options.scoreThreshold,
      maxResults: numberOption(options, "maxResults", 8),
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
