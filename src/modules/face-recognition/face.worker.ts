/// <reference lib="webworker" />
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import type { WorkerInitPayload, WorkerRequest, WorkerResponse } from "@/core/workers/protocol";
import type { Detection } from "@/shared/contracts/vision";
import { alignFace, landmarksFor, SIZE } from "./align";
import { toFaceDetectionsWithSource, type RawFaceDetection } from "./mapping";

/**
 * Face detection and the numbers that tell faces apart, off the main thread. Bitmap in, boxes out, each with
 * 128 numbers describing the face: the image is closed here and never stored, so no picture of a face outlives
 * the frame it arrived in; only the numbers go on.
 */

// The ONNX runtime is a plain script: `importScripts` makes it the global `ort`.
declare const ort: {
  env: { wasm: { wasmPaths: string; numThreads: number } };
  InferenceSession: { create(url: string, options: object): Promise<OrtSession> };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => unknown;
};
declare function importScripts(...urls: string[]): void;

type OrtSession = {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>;
};

/** Faces turned into numbers per frame, largest first; each costs tens of milliseconds, more on a phone. */
const MAX_EMBEDDED = 3;
/** A face that has hardly moved keeps the numbers it was given, for this long, ms. */
const REUSE_MS = 700;
const REUSE_IOU = 0.6;

let detector: FaceDetector | null = null;
let session: OrtSession | null = null;
let canvas: OffscreenCanvas | null = null;
let options: WorkerInitPayload | null = null;
let lastTimestamp = 0;

type Remembered = { bounds: Detection["bounds"]; embedding: string; at: number };
let remembered: Remembered[] = [];

const post = (message: WorkerResponse): void => {
  self.postMessage(message);
};

const numberOption = (payload: WorkerInitPayload, key: string, fallback: number): number => {
  const value = payload.options?.[key];
  return typeof value === "number" ? value : fallback;
};

const stringOption = (payload: WorkerInitPayload, key: string): string => {
  const value = payload.options?.[key];
  if (typeof value !== "string" || value === "") throw new Error(`worker option ${key} is missing`);
  return value;
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

const createSession = async (payload: WorkerInitPayload): Promise<OrtSession> => {
  importScripts(stringOption(payload, "ortScriptUrl"));
  ort.env.wasm.wasmPaths = stringOption(payload, "ortBase");
  // One thread: more needs cross-origin isolation, which this page does not have.
  ort.env.wasm.numThreads = 1;
  return ort.InferenceSession.create(stringOption(payload, "embeddingUrl"), { executionProviders: ["wasm"] });
};

const initialize = async (payload: WorkerInitPayload): Promise<void> => {
  try {
    options = payload;
    detector = await createDetector(payload);
    session = await createSession(payload);
    canvas = new OffscreenCanvas(SIZE, SIZE);
    post({ type: "ready" });
  } catch (error) {
    post({ type: "init-failed", message: (error as Error).message });
  }
};

const area = (box: Detection["bounds"]): number => box.width * box.height;

const overlap = (a: Detection["bounds"], b: Detection["bounds"]): number => {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const shared = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = area(a) + area(b) - shared;
  return union > 0 ? shared / union : 0;
};

/** 128 numbers as base64 of their bytes: a detection's attributes can hold a string, not a list. */
const encode = (values: Float32Array): string => {
  const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  let text = "";
  for (let i = 0; i < bytes.length; i += 1) text += String.fromCharCode(bytes[i] as number);
  return btoa(text);
};

/** The numbers for one face, or null when its landmarks cannot line it up. */
const embed = async (image: ImageBitmap, raw: RawFaceDetection): Promise<string | null> => {
  if (!session || !canvas) return null;
  const marks = landmarksFor(raw.keypoints, image.width, image.height);
  const move = marks ? alignFace(marks) : null;
  if (!move) return null;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, SIZE, SIZE);
  context.setTransform(move.a, move.b, move.c, move.d, move.e, move.f);
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, SIZE, SIZE).data;

  // The model takes red, green, blue planes of 0..255, one after the other.
  const input = new Float32Array(3 * SIZE * SIZE);
  const plane = SIZE * SIZE;
  for (let i = 0; i < plane; i += 1) {
    input[i] = pixels[i * 4] as number;
    input[plane + i] = pixels[i * 4 + 1] as number;
    input[2 * plane + i] = pixels[i * 4 + 2] as number;
  }
  const feeds = { [session.inputNames[0] as string]: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]) };
  const output = (await session.run(feeds))[session.outputNames[0] as string];
  if (!output) return null;

  // Length one, so two faces are compared by the angle between their numbers alone.
  const values = Float32Array.from(output.data);
  let norm = 0;
  for (const value of values) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm < 1e-6) return null;
  for (let i = 0; i < values.length; i += 1) values[i] = (values[i] as number) / norm;
  return encode(values);
};

const infer = async (request: Extract<WorkerRequest, { type: "infer" }>): Promise<void> => {
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

    const found = toFaceDetectionsWithSource(result.detections as readonly RawFaceDetection[], {
      imageWidth: image.width,
      imageHeight: image.height,
      minConfidence: options.scoreThreshold,
      maxResults: numberOption(options, "maxResults", 8),
    });

    const now = performance.now();
    remembered = remembered.filter((item) => now - item.at < REUSE_MS);
    const kept: Remembered[] = [];
    // Largest first: the face in front of the wearer is the one worth the time.
    const order = found.map((_, index) => index).sort((a, b) => area((found[b] as (typeof found)[number]).detection.bounds) - area((found[a] as (typeof found)[number]).detection.bounds));
    const embeddings = new Map<number, string>();
    for (const index of order.slice(0, MAX_EMBEDDED)) {
      const item = found[index] as (typeof found)[number];
      const same = remembered.find((old) => overlap(old.bounds, item.detection.bounds) >= REUSE_IOU);
      const embedding = same?.embedding ?? (await embed(image, item.raw));
      if (embedding) {
        embeddings.set(index, embedding);
        kept.push({ bounds: item.detection.bounds, embedding, at: same?.at ?? now });
      }
    }
    remembered = kept;

    const detections: Detection[] = found.map((item, index) => {
      const embedding = embeddings.get(index);
      return embedding
        ? { ...item.detection, attributes: { ...item.detection.attributes, embedding } }
        : item.detection;
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
      void infer(request);
      break;
    case "dispose":
      detector?.close();
      detector = null;
      session = null;
      remembered = [];
      break;
  }
});
