import type { ModuleManifest } from "@/shared/contracts/vision";
import { validateModuleManifest } from "@/shared/validation/schemas";
import type { VisionModule } from "./module-contract";

export type ModuleRegistration = Readonly<{
  manifest: ModuleManifest;
  /** Lazy factory so a module's model is only fetched when it is enabled. */
  load: () => Promise<VisionModule>;
}>;

/**
 * Catalogue of known modules. The Plugin Palette reads from here instead of
 * scanning files, and manifests are validated at registration so a malformed
 * module can never reach the runtime.
 */
export class ModuleRegistry {
  private readonly registrations = new Map<string, ModuleRegistration>();

  register(registration: ModuleRegistration): void {
    const result = validateModuleManifest(registration.manifest);
    if (!result.ok) {
      throw new Error(`Invalid manifest for "${registration.manifest.id}": ${result.error}`);
    }
    if (this.registrations.has(registration.manifest.id)) {
      throw new Error(`Module "${registration.manifest.id}" is already registered`);
    }
    this.registrations.set(registration.manifest.id, registration);
  }

  get(id: string): ModuleRegistration | undefined {
    return this.registrations.get(id);
  }

  list(): readonly ModuleRegistration[] {
    return [...this.registrations.values()];
  }

  manifests(): readonly ModuleManifest[] {
    return this.list().map((registration) => registration.manifest);
  }
}
