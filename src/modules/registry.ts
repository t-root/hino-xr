import type { ModuleRegistry } from "@/core/modules/module-registry";
import { plugins } from "./plugins.generated";

/**
 * Hands Core the plugins that exist.
 *
 * The list is not written here: `assistant/frontend.py` makes `plugins.generated.ts` at every build from the folders that
 * hold a `plugin.ts`, in path order so the catalogue, and therefore the palette order, does not depend on how the directory
 * was walked. Adding a plugin is adding a folder, and nothing else in the tree changes.
 */
export const registerBuiltInModules = (registry: ModuleRegistry): void => {
  for (const entry of plugins) registry.register(entry);
};
