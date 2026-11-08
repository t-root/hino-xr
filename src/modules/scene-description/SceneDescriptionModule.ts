import { ASSETS } from "@/core/config";
import { createDetectorModule } from "@/core/modules/DetectorModule";
import type { ModuleContext, VisionModule } from "@/core/modules/module-contract";
import { spawnInferenceWorker } from "@/core/workers/spawn";
import type { DetectionBatch, FramePacket } from "@/shared/contracts/vision";
import { SCENE_MODEL_URL } from "./assets";
import { sceneDescriptionManifest } from "./manifest";
import { describeScene, peakCounts, type Counts } from "./summary";
import text from "./text.json";

/** Below this the small model's guesses are mostly shadows and reflections. */
const MIN_CONFIDENCE = 0.4;
const MAX_RESULTS = 20;

/** The looks that count as "now" when asked what is in view, ms. */
const WINDOW_MS = 2500;

type Look = Readonly<{ at: number; counts: Counts }>;

/**
 * Says what is in front of the camera. It runs its own object detector (nothing is shared between plugins) and
 * draws nothing: it keeps the last few seconds of what was found and, asked "what do I see?", reads that out.
 */
class SceneDescriptionModule implements VisionModule {
  readonly manifest = sceneDescriptionManifest;

  private readonly detector = createDetectorModule({
    manifest: sceneDescriptionManifest,
    createWorker: () => spawnInferenceWorker("modules/scene-description/scene.worker.ts"),
    init: {
      wasmBase: ASSETS.wasmBase,
      modelUrl: SCENE_MODEL_URL,
      scoreThreshold: MIN_CONFIDENCE,
      options: { maxResults: MAX_RESULTS },
    },
    maxMissedFrames: 8,
  });

  private context: ModuleContext | null = null;
  private looks: Look[] = [];

  async initialize(context: ModuleContext): Promise<void> {
    this.context = context;
    await this.detector.initialize(context);
  }

  async process(frame: FramePacket, signal: AbortSignal): Promise<DetectionBatch> {
    const batch = await this.detector.process(frame, signal);
    const now = performance.now();
    const counts = new Map<string, number>();
    for (const detection of batch.detections) counts.set(detection.kind, (counts.get(detection.kind) ?? 0) + 1);
    this.looks = [...this.looks.filter((look) => now - look.at < WINDOW_MS), { at: now, counts }];
    // Nothing to draw: the answer is spoken.
    return { ...batch, detections: [] };
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (!enabled) this.looks = [];
    await this.detector.setEnabled(enabled);
  }

  async command(name: string, payload: Readonly<Record<string, unknown>>): Promise<string | null> {
    if (name !== "sight" || payload.what !== "scene") return null;
    const locale = this.context?.locale() ?? "vi";
    const now = performance.now();
    const recent = this.looks.filter((look) => now - look.at < WINDOW_MS).map((look) => look.counts);
    return recent.length === 0 ? text.nothing[locale] : describeScene(peakCounts(recent), locale);
  }

  async dispose(): Promise<void> {
    this.looks = [];
    await this.detector.dispose();
  }
}

export const createSceneDescriptionModule = (): VisionModule => new SceneDescriptionModule();
