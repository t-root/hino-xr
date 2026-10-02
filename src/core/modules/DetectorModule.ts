import type { Locale } from "@/shared/contracts/locale";
import type { Detection, DetectionBatch, FramePacket, ModuleManifest } from "@/shared/contracts/vision";
import { IouTracker } from "@/shared/math/iou-tracker";
import type { WorkerInitPayload } from "../workers/protocol";
import { InferenceWorkerClient } from "../workers/worker-pool";
import type { ModuleContext, VisionModule } from "./module-contract";

type DetectorModuleOptions = Readonly<{
  manifest: ModuleManifest;
  /** The plugin's own worker file; spawned when the plugin is switched on. */
  createWorker: () => Worker;
  init: WorkerInitPayload;
  /** Frames a subject may be missing before its id is given up. */
  maxMissedFrames?: number;
  /**
   * What to write above a box, in the language the interface is in.
   *
   * Asked for here rather than sent back by the worker: the worker is loaded
   * once with a model and has no way of hearing that the language changed,
   * whereas this runs per frame, on the side that knows. A detector with many
   * classes reads the class from `detection.kind` and names each box.
   */
  label?: (locale: Locale, detection: Detection) => string;
}>;

/**
 * The body every worker-backed detector plugin turns out to need: spawn the
 * worker, hand it frames one at a time, put stable ids on what comes back.
 *
 * It exists so a plugin folder is a manifest, a worker and the mapping from
 * that model's output to detections — the parts that actually differ. What is
 * left here is lifecycle, and lifecycle bugs (a worker left running after
 * dispose, ids that change every frame) are the kind each plugin would
 * otherwise get to reinvent and get wrong on its own.
 */
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
      // A model that never loaded must not leave a worker behind holding it.
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

    // Detectors report unordered boxes with no memory of the frame before, so
    // the id a box keeps across frames is decided here, by overlap.
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
    // Ids start again on the next run: whatever was in view has had time to go.
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
