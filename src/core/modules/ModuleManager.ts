import { format, joinLocalized, message, permissionKey } from "@/i18n/text";
import type { Locale, LocalizedText } from "@/shared/contracts/locale";
import type { DetectionBatch, FramePacket, ModuleState } from "@/shared/contracts/vision";
import { localizedTextOf } from "@/shared/errors/localized";
import { validateDetectionBatch } from "@/shared/validation/schemas";
import type { Unsubscribe } from "../events/EventBus";
import type { EventBus } from "../events/EventBus";
import type { RuntimeEvents } from "../events/events";
import type { FrameHub } from "../camera/FrameHub";
import { createLogger } from "../observability/diagnostics";
import type { Metrics } from "../observability/metrics";
import type { ModuleContext, VisionModule } from "./module-contract";
import type { ModuleRegistry } from "./module-registry";
import { budgetFor, withTimeout, type ModuleBudget } from "./ModuleScheduler";
import type { ModuleScreenFactory, ModuleScreenHandle } from "./ModuleScreenHost";
import { missingPermissions } from "./permissions";

type ModuleRuntime = {
  readonly id: string;
  readonly budget: ModuleBudget;
  module: VisionModule | null;
  /** Only for a plugin granted `screen`; lives as long as `module` does. */
  screen: ModuleScreenHandle | null;
  state: ModuleState;
  unregisterConsumer: Unsubscribe | null;
  consecutiveFailures: number;
  lastError: LocalizedText | null;
  lastLatencyMs: number;
  batches: number;
};

export type ModuleStatus = Readonly<{
  id: string;
  state: ModuleState;
  /** Shown to the user, so it carries every language rather than one. */
  lastError: LocalizedText | null;
  lastLatencyMs: number;
  batches: number;
}>;

/**
 * Owns module lifecycle and isolates their failures. A module that throws,
 * times out or returns an invalid payload is paused; the camera, renderer and
 * every other module keep running.
 */
export class ModuleManager {
  private readonly runtimes = new Map<string, ModuleRuntime>();
  private readonly logger;

  constructor(
    private readonly bus: EventBus<RuntimeEvents>,
    private readonly registry: ModuleRegistry,
    private readonly frameHub: FrameHub,
    private readonly metrics: Metrics,
    private readonly moduleFps: () => number,
    private readonly locale: () => Locale = () => "vi",
    /** Absent in tests and headless runs: `screen` is then never handed out. */
    private readonly screenFor: ModuleScreenFactory | null = null,
  ) {
    this.logger = createLogger("module-manager", bus);
  }

  statuses(): readonly ModuleStatus[] {
    return this.registry.manifests().map((manifest) => {
      const runtime = this.runtimes.get(manifest.id);
      return {
        id: manifest.id,
        state: runtime?.state ?? "idle",
        lastError: runtime?.lastError ?? null,
        lastLatencyMs: runtime?.lastLatencyMs ?? 0,
        batches: runtime?.batches ?? 0,
      };
    });
  }

  stateOf(id: string): ModuleState {
    return this.runtimes.get(id)?.state ?? "idle";
  }

  isEnabled(id: string): boolean {
    const state = this.stateOf(id);
    return state === "ready" || state === "loading";
  }

  async enable(id: string): Promise<void> {
    const registration = this.registry.get(id);
    if (!registration) throw new Error(`Unknown module "${id}"`);
    if (this.isEnabled(id)) return;

    const runtime: ModuleRuntime = this.runtimes.get(id) ?? {
      id,
      budget: budgetFor(registration.manifest.input.preferredFps),
      module: null,
      screen: null,
      state: "idle",
      unregisterConsumer: null,
      consecutiveFailures: 0,
      lastError: null,
      lastLatencyMs: 0,
      batches: 0,
    };
    this.runtimes.set(id, runtime);

    // Checked before the model is fetched, and before a line of the plugin has
    // run: a folder that asks for more than frames stays switched off until
    // somebody grants it that outside the plugin (`permissions.ts`).
    const missing = missingPermissions(registration.manifest);
    if (missing.length > 0) {
      // Written in every language at once: this is stored and read back later,
      // by which time the interface may be in the other one.
      const names = missing.map((permission) => message(permissionKey(permission)));
      runtime.lastError = format(message("module.missingPermissions"), {
        list: joinLocalized(names),
      });
      this.setState(runtime, "failed", new Error(runtime.lastError.en));
      this.logger.error(`module "${id}" blocked`, { message: runtime.lastError.en });
      return;
    }

    this.setState(runtime, "loading");

    try {
      const module = runtime.module ?? (await registration.load());
      if (!runtime.module) {
        const wantsScreen = registration.manifest.permissions.includes("screen");
        if (wantsScreen && this.screenFor && !runtime.screen) runtime.screen = this.screenFor(id);
        // Shown while it loads, so a plugin can say it is busy on its own screen.
        runtime.screen?.setVisible(true);
        await module.initialize(this.createContext(id, runtime.screen));
        runtime.module = module;
      }
      await module.setEnabled(true);

      const fps = Math.min(registration.manifest.input.preferredFps, this.moduleFps());
      const maxSize = Math.max(
        registration.manifest.input.maxWidth ?? 0,
        registration.manifest.input.maxHeight ?? 0,
      );
      runtime.unregisterConsumer = this.frameHub.registerConsumer({
        id: `module.${id}`,
        preferredFps: fps,
        ...(maxSize > 0 ? { maxSize } : {}),
        onFrame: (packet) => this.runModule(runtime, packet),
      });

      runtime.consecutiveFailures = 0;
      runtime.lastError = null;
      this.setState(runtime, "ready");
    } catch (error) {
      // A plugin that never started must not leave what it drew behind; the
      // next attempt starts from an empty screen.
      if (!runtime.module) {
        runtime.screen?.dispose();
        runtime.screen = null;
      }
      runtime.lastError = localizedTextOf(error);
      this.setState(runtime, "failed", error as Error);
      this.logger.error(`module "${id}" failed to start`, { message: runtime.lastError.en });
    }
  }

  async disable(id: string): Promise<void> {
    const runtime = this.runtimes.get(id);
    if (!runtime) return;
    runtime.unregisterConsumer?.();
    runtime.unregisterConsumer = null;
    try {
      await runtime.module?.setEnabled(false);
    } catch (error) {
      this.logger.warn(`module "${id}" threw while disabling`, { message: (error as Error).message });
    }
    this.setState(runtime, "paused");
  }

  /**
   * Parks a module that failed outside `process()` — in code Core runs for it,
   * such as drawing its screen — with the reason shown in the menu.
   */
  fail(id: string, error: unknown): void {
    const runtime = this.runtimes.get(id);
    if (!runtime || runtime.state === "failed") return;
    runtime.unregisterConsumer?.();
    runtime.unregisterConsumer = null;
    runtime.lastError = localizedTextOf(error);
    this.setState(runtime, "failed", error instanceof Error ? error : new Error(runtime.lastError.en));
    this.logger.error(`module "${id}" failed`, { message: runtime.lastError.en });
  }

  async toggle(id: string): Promise<void> {
    if (this.isEnabled(id)) await this.disable(id);
    else await this.enable(id);
  }

  async disposeAll(): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      runtime.unregisterConsumer?.();
      try {
        await runtime.module?.dispose();
      } catch {
        // A failing dispose must not block teardown of the remaining modules.
      }
      runtime.screen?.dispose();
      runtime.screen = null;
    }
    this.runtimes.clear();
  }

  /**
   * Runs one frame through a module. The frame's bitmap is always released
   * here, whether the module consumed it, transferred it or threw.
   */
  private async runModule(runtime: ModuleRuntime, packet: FramePacket): Promise<void> {
    const module = runtime.module;
    if (!module || runtime.state !== "ready") {
      packet.image.close();
      return;
    }

    const started = performance.now();
    try {
      const batch = await withTimeout(
        (signal) => module.process(packet, signal),
        runtime.budget.timeoutMs,
      );
      runtime.lastLatencyMs = performance.now() - started;
      this.metrics.timing(`module.${runtime.id}.inference`, runtime.lastLatencyMs);
      this.publish(runtime, packet, batch);
      runtime.consecutiveFailures = 0;
    } catch (error) {
      this.handleFailure(runtime, error as Error);
    } finally {
      packet.image.close();
    }
  }

  private publish(runtime: ModuleRuntime, packet: FramePacket, batch: DetectionBatch): void {
    const result = validateDetectionBatch(batch);
    if (!result.ok) {
      this.handleFailure(runtime, new Error(`invalid detection batch: ${result.error}`));
      return;
    }
    if (result.value.moduleId !== runtime.id) {
      this.handleFailure(runtime, new Error("module returned a batch for a different module id"));
      return;
    }
    if (result.value.sourceFrameId !== packet.id) {
      this.handleFailure(runtime, new Error("module returned a batch for a different frame"));
      return;
    }
    runtime.batches += 1;
    this.metrics.count(`module.${runtime.id}.detections`, result.value.detections.length);
    this.bus.emit("detection.batch", result.value);
  }

  private handleFailure(runtime: ModuleRuntime, error: Error): void {
    runtime.consecutiveFailures += 1;
    runtime.lastError = localizedTextOf(error);
    this.metrics.count(`module.${runtime.id}.errors`);

    if (runtime.consecutiveFailures < runtime.budget.maxConsecutiveFailures) {
      this.logger.warn(`module "${runtime.id}" frame failed`, { message: error.message });
      return;
    }

    runtime.unregisterConsumer?.();
    runtime.unregisterConsumer = null;
    this.setState(runtime, "failed", error);
    this.logger.error(`module "${runtime.id}" disabled after repeated failures`, {
      message: error.message,
    });
  }

  private setState(runtime: ModuleRuntime, state: ModuleState, error?: Error): void {
    runtime.state = state;
    // Whatever the plugin itself does, a switched-off plugin covers nothing.
    runtime.screen?.setVisible(state === "ready" || state === "loading");
    this.bus.emit("module.state", error ? { moduleId: runtime.id, state, error } : { moduleId: runtime.id, state });
  }

  private createContext(id: string, screen: ModuleScreenHandle | null): ModuleContext {
    return {
      logger: {
        debug: (message) => this.logger.debug(`[${id}] ${message}`),
        warn: (message) => this.logger.warn(`[${id}] ${message}`),
        error: (message) => this.logger.error(`[${id}] ${message}`),
      },
      metrics: {
        timing: (name, ms) => this.metrics.timing(`module.${id}.${name}`, ms),
        count: (name, value) => this.metrics.count(`module.${id}.${name}`, value),
      },
      config: {},
      locale: this.locale,
      screen: screen?.screen ?? null,
    };
  }
}
