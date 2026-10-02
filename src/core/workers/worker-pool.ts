import type { Detection } from "@/shared/contracts/vision";
import type { WorkerInitPayload, WorkerRequest, WorkerResponse } from "./protocol";

type Pending = {
  readonly resolve: (detections: readonly Detection[]) => void;
  readonly reject: (error: Error) => void;
};

/**
 * One worker per module with a request queue depth of one. Inference never runs
 * on the main thread, and a stalled model can only ever block its own worker.
 */
export class InferenceWorkerClient {
  private readonly pending = new Map<number, Pending>();
  private requestCounter = 0;
  private readyPromise: Promise<void> | null = null;

  constructor(private readonly worker: Worker) {
    worker.addEventListener("message", this.onMessage);
  }

  initialize(payload: WorkerInitPayload): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise<void>((resolve, reject) => {
      const onMessage = (event: MessageEvent<WorkerResponse>) => {
        if (event.data.type === "ready") {
          this.worker.removeEventListener("message", onMessage);
          resolve();
        } else if (event.data.type === "init-failed") {
          this.worker.removeEventListener("message", onMessage);
          reject(new Error(event.data.message));
        }
      };
      this.worker.addEventListener("message", onMessage);
      this.worker.addEventListener("error", (event) => reject(new Error(event.message)), { once: true });
      this.post({ type: "init", payload });
    });
    return this.readyPromise;
  }

  /** Transfers ownership of `image`; the caller must not use it afterwards. */
  infer(
    image: ImageBitmap,
    frame: { frameId: number; timestampMs: number; rotationDeg: 0 | 90 | 180 | 270; mirrored: boolean },
    signal: AbortSignal,
  ): Promise<readonly Detection[]> {
    const requestId = ++this.requestCounter;
    return new Promise<readonly Detection[]>((resolve, reject) => {
      if (signal.aborted) {
        image.close();
        reject(new Error("Inference aborted"));
        return;
      }
      this.pending.set(requestId, { resolve, reject });
      signal.addEventListener(
        "abort",
        () => {
          const entry = this.pending.get(requestId);
          if (!entry) return;
          this.pending.delete(requestId);
          entry.reject(new Error("Inference aborted"));
        },
        { once: true },
      );
      this.worker.postMessage(
        {
          type: "infer",
          requestId,
          frameId: frame.frameId,
          timestampMs: frame.timestampMs,
          rotationDeg: frame.rotationDeg,
          mirrored: frame.mirrored,
          image,
        } satisfies WorkerRequest,
        [image],
      );
    });
  }

  dispose(): void {
    for (const entry of this.pending.values()) entry.reject(new Error("Worker disposed"));
    this.pending.clear();
    this.post({ type: "dispose" });
    this.worker.removeEventListener("message", this.onMessage);
    this.worker.terminate();
  }

  private post(message: WorkerRequest): void {
    this.worker.postMessage(message);
  }

  private readonly onMessage = (event: MessageEvent<WorkerResponse>): void => {
    const data = event.data;
    if (data.type === "result") {
      this.pending.get(data.requestId)?.resolve(data.detections);
      this.pending.delete(data.requestId);
    } else if (data.type === "error") {
      this.pending.get(data.requestId)?.reject(new Error(data.message));
      this.pending.delete(data.requestId);
    }
  };
}
