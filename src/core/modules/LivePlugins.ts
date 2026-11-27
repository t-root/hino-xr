import { createLogger } from "../observability/diagnostics";
import type { EventBus } from "../events/EventBus";
import type { RuntimeEvents } from "../events/events";
import type { PluginEntry } from "./definePlugin";
import type { ModuleManager } from "./ModuleManager";
import type { ModuleRegistry } from "./module-registry";

type LiveMap = Readonly<Record<string, string>>;

declare global {
  interface Window {
    __hinoLive?: LiveMap;
  }
}

export class LivePlugins {
  private readonly loaded = new Map<string, string>();
  private readonly logger;
  private queue: Promise<void> = Promise.resolve();
  private readonly listener = (event: Event) => this.sync((event as CustomEvent<LiveMap>).detail);

  constructor(
    bus: EventBus<RuntimeEvents>,
    private readonly registry: ModuleRegistry,
    private readonly modules: ModuleManager,
    private readonly changed: () => void,
  ) {
    this.logger = createLogger("live-plugins", bus);
  }

  start(): void {
    window.addEventListener("hino-live", this.listener);
    this.sync(window.__hinoLive ?? {});
  }

  stop(): void {
    window.removeEventListener("hino-live", this.listener);
  }

  private sync(wanted: LiveMap): void {
    this.queue = this.queue.then(() => this.apply(wanted)).catch(() => undefined);
  }

  private async apply(wanted: LiveMap): Promise<void> {
    let touched = false;
    for (const id of [...this.loaded.keys()]) {
      if (id in wanted) continue;
      await this.modules.forget(id);
      this.registry.unregister(id);
      this.loaded.delete(id);
      this.styleOf(id, null);
      touched = true;
    }
    for (const [id, hash] of Object.entries(wanted)) {
      if (this.loaded.get(id) === hash) continue;
      try {
        const entry = await this.fetchEntry(id, hash);
        this.styleOf(id, hash);
        const wasOn = this.modules.isEnabled(id);
        if (this.registry.has(id)) await this.modules.forget(id);
        this.registry.replace(entry);
        this.loaded.set(id, hash);
        touched = true;
        if (wasOn) await this.modules.enable(id);
      } catch (error) {
        this.logger.warn(`live plugin "${id}" did not load`, { message: error instanceof Error ? error.message : String(error) });
      }
    }
    if (touched) this.changed();
  }

  private styleOf(id: string, hash: string | null): void {
    const old = document.querySelector(`link[data-live-plugin="${id}"]`);
    if (hash === null || !hash.endsWith(":css")) {
      old?.remove();
      return;
    }
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.dataset.livePlugin = id;
    link.href = `/live/${id}.css?v=${hash.slice(0, -4)}`;
    link.onload = () => old?.remove();
    document.head.append(link);
  }

  private async fetchEntry(id: string, hash: string): Promise<PluginEntry> {
    const loaded = (await import( `/live/${id}.js?v=${hash.replace(":css", "")}`)) as {
      default?: PluginEntry;
    };
    const entry = loaded.default;
    if (!entry || typeof entry.load !== "function" || entry.manifest?.id !== id) {
      throw new Error("the file is not a plugin of that id");
    }
    return entry;
  }
}
