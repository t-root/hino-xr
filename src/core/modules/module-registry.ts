import type { ModuleManifest } from "@/shared/contracts/vision";
import { validateModuleManifest } from "@/shared/validation/schemas";
import type { VisionModule } from "./module-contract";

export type ModuleRegistration = Readonly<{
  manifest: ModuleManifest;
  load: () => Promise<VisionModule>;
}>;

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

  has(id: string): boolean {
    return this.registrations.has(id);
  }

  replace(registration: ModuleRegistration): void {
    const result = validateModuleManifest(registration.manifest);
    if (!result.ok) {
      throw new Error(`Invalid manifest for "${registration.manifest.id}": ${result.error}`);
    }
    this.registrations.set(registration.manifest.id, registration);
  }

  unregister(id: string): void {
    this.registrations.delete(id);
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
