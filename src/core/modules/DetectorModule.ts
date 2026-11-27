import type { Locale } from "@/shared/contracts/locale";
import type { Detection, DetectionBatch, FramePacket, ModuleManifest } from "@/shared/contracts/vision";
import { IouTracker } from "@/shared/math/iou-tracker";
import type { WorkerInitPayload } from "../workers/protocol";
import { InferenceWorkerClient } from "../workers/worker-pool";
import type { ModuleContext, VisionModule } from "./module-contract";

type DetectorModuleOptions = Readonly<{
  manifest: ModuleManifest;
  createWorker: () => Worker;
  init: WorkerInitPayload;
  maxMissedFrames?: number;
  label?: (locale: Locale, detection: Detection) => string;
}>;

class DetectorModule implements VisionModule {
  readonly manifest: ModuleManifest;

  private readonly tracker: IouTracker;
  private client: InferenceWorkerClient | null = null;
  private context: ModuleContext | null = null;
  private enabled = false;

  constructor(private readonly options: DetectorModuleOptions) {
    this.manifest = options.manifest;
    this.tracker = new IouTracker(0.3, options.maxMissedFrames ?? 6);
  }

  async initialize(context: ModuleContext): Promise<void> {
    this.context = context;
    const client = new InferenceWorkerClient(this.options.createWorker());
    try {
      await client.initialize(this.options.init);
    } catch (error) {
      client.dispose();
      throw error;
    }
    this.client = client;
    context.logger.debug("worker ready");
  }

  async process(frame: FramePacket, signal: AbortSignal): Promise<DetectionBatch> {
    const empty: DetectionBatch = {
      moduleId: this.manifest.id,
      sourceFrameId: frame.id,
      producedAtMs: performance.now(),
      detections: [],
    };
    if (!this.client || !this.enabled) return empty;

    const started = performance.now();
    const raw = await this.client.infer(
      frame.image,
      {
        frameId: frame.id,
        timestampMs: frame.timestampMs,
        rotationDeg: frame.rotationDeg,
        mirrored: frame.mirrored,
      },
      signal,
    );
    this.context?.metrics.timing("worker", performance.now() - started);

    const ids = this.tracker.assign(raw.map((detection) => detection.bounds));
    const locale = this.context?.locale() ?? "vi";
    return {
      ...empty,
      producedAtMs: performance.now(),
      detections: raw.map((detection, index) => {
        const label = this.options.label?.(locale, detection);
        return { ...detection, id: ids[index] ?? `${index}`, ...(label ? { label } : {}) };
      }),
    };
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    if (!enabled) this.tracker.reset();
  }

  async dispose(): Promise<void> {
    this.enabled = false;
    this.client?.dispose();
    this.client = null;
  }
}

export const createDetectorModule = (options: DetectorModuleOptions): VisionModule =>
  new DetectorModule(options);
