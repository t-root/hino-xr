import type { DetectionBatch, FramePacket } from "@/shared/contracts/vision";
import type { ModuleContext, VisionModule } from "@/core/modules/module-contract";
import { demoMotionManifest } from "./manifest";
import text from "./text.json";

/**
 * Reference implementation of the module contract with no model behind it.
 * It exists so the overlay, alignment and interaction paths can be exercised
 * offline, on any device, without downloading weights.
 */
class DemoMotionModule implements VisionModule {
  readonly manifest = demoMotionManifest;
  private enabled = false;
  private startedAtMs = 0;
  private context: ModuleContext | null = null;

  async initialize(context: ModuleContext): Promise<void> {
    this.startedAtMs = performance.now();
    this.context = context;
    context.logger.debug("demo module ready");
  }

  async process(frame: FramePacket): Promise<DetectionBatch> {
    const elapsed = (performance.now() - this.startedAtMs) / 1000;
    const width = 0.22;
    const height = 0.3;
    const x = 0.5 + Math.cos(elapsed * 0.9) * 0.25 - width / 2;
    const y = 0.5 + Math.sin(elapsed * 1.3) * 0.18 - height / 2;

    return {
      moduleId: this.manifest.id,
      sourceFrameId: frame.id,
      producedAtMs: performance.now(),
      detections: this.enabled
        ? [
            {
              id: "demo-target",
              kind: "object",
              bounds: { x, y, width, height },
              confidence: 0.9,
              label: text.label[this.context?.locale() ?? "vi"],
              interaction: { selectable: true, detailAction: "inspect" },
            },
          ]
        : [],
    };
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
  }

  async dispose(): Promise<void> {
    this.enabled = false;
  }
}

export const createDemoMotionModule = (): VisionModule => new DemoMotionModule();
