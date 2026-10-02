import type { PluginPaletteItem, PluginPaletteController as Controller } from "@/shared/contracts/plugin";
import type { ModuleManager } from "../modules/ModuleManager";
import type { ModuleRegistry } from "../modules/module-registry";

/**
 * Plugin list for the settings menu. There is no 3D palette of cards.
 */
export class PluginPaletteController implements Controller {
  constructor(
    private readonly registry: ModuleRegistry,
    private readonly modules: ModuleManager,
  ) {}

  items(): readonly PluginPaletteItem[] {
    const statuses = new Map(this.modules.statuses().map((status) => [status.id, status]));
    return this.registry.manifests().map((manifest) => {
      const status = statuses.get(manifest.id);
      return {
        id: manifest.id,
        title: manifest.displayName,
        description: manifest.description,
        state: status?.state === "idle" ? "available" : (status?.state ?? "available"),
        capabilities: manifest.outputKinds,
        permissions: manifest.permissions,
        canConfigure: false,
        enabled: this.modules.isEnabled(manifest.id),
      };
    });
  }
}
