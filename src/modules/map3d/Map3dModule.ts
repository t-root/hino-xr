import type { ModuleContext, VisionModule } from "@/core/modules/module-contract";
import type { DetectionBatch, FramePacket } from "@/shared/contracts/vision";
import { LocalizedError } from "@/shared/errors/localized";
import { sameInEveryLocale } from "@/shared/contracts/locale";
import { Map3dApp } from "./Map3dApp";
import { map3dManifest } from "./manifest";
import { syncPalette } from "./palette";
import { Words } from "./ui";

/**
 * map3d as a plugin: the original application, on a screen of its own that
 * Core draws in each eye while the plugin is on. Mouse and touch for now.
 *
 * Frames are received only because every plugin is a frame consumer; each one
 * is answered with an empty batch.
 */
class Map3dModule implements VisionModule {
  readonly manifest = map3dManifest;

  private app: Map3dApp | null = null;

  async initialize(context: ModuleContext): Promise<void> {
    const screen = context.screen;
    if (!screen) {
      throw new LocalizedError(sameInEveryLocale("map3d needs the `screen` permission from permissions.ts"));
    }
    syncPalette();
    const app = new Map3dApp(new Words(() => context.locale()), () => screen.close());
    this.app = app;
    screen.show((element) => app.mount(element));
  }

  async process(frame: FramePacket): Promise<DetectionBatch> {
    return {
      moduleId: this.manifest.id,
      sourceFrameId: frame.id,
      producedAtMs: performance.now(),
      detections: [],
    };
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (enabled && syncPalette()) this.app?.applyPalette();
    this.app?.setActive(enabled);
  }

  async dispose(): Promise<void> {
    this.app?.dispose();
    this.app = null;
  }
}

export const createMap3dModule = (): VisionModule => new Map3dModule();
