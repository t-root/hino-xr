import type { ModuleContext, VisionModule } from "@/core/modules/module-contract";
import { sameInEveryLocale } from "@/shared/contracts/locale";
import type { DetectionBatch, FramePacket } from "@/shared/contracts/vision";
import { LocalizedError } from "@/shared/errors/localized";
import { spaceScannerManifest } from "./manifest";
import { SpaceScannerApp } from "./SpaceScannerApp";

class SpaceScannerModule implements VisionModule {
  readonly manifest = spaceScannerManifest;
  private app: SpaceScannerApp | null = null;
  private enabled = false;

  async initialize(context: ModuleContext): Promise<void> {
    const screen = context.screen;
    if (!screen) {
      throw new LocalizedError(
        sameInEveryLocale("space-scanner needs the `screen` permission from permissions.ts"),
      );
    }
    const app = new SpaceScannerApp(() => context.locale(), () => screen.close());
    this.app = app;
    screen.show((element) => app.mount(element));
  }

  async process(frame: FramePacket): Promise<DetectionBatch> {
    const detections = this.enabled && this.app ? this.app.analyzeFrame(frame) : [];
    return {
      moduleId: this.manifest.id,
      sourceFrameId: frame.id,
      producedAtMs: performance.now(),
      detections,
    };
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    this.app?.setActive(enabled);
  }

  async dispose(): Promise<void> {
    this.enabled = false;
    this.app?.dispose();
    this.app = null;
  }
}

export const createSpaceScannerModule = (): VisionModule => new SpaceScannerModule();
