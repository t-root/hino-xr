import type { PluginEntry } from "@/core/modules/definePlugin";
import type { ModuleRegistry } from "@/core/modules/module-registry";
import demoMotion from "./demo-motion/plugin";
import faceDetection from "./face-detection/plugin";
import map3d from "./map3d/plugin";
import objectDetection from "./object-detection/plugin";
import personDetection from "./person-detection/plugin";

/**
 * Every plugin folder that declares itself.
 *
 * The Python bundler has no `import.meta.glob`, so the folders are imported
 * here. Adding a plugin is still adding a folder plus one line in this file.
 * Sorted by path so the catalogue, and therefore the palette order, does not
 * depend on how the directory was walked.
 */
const entries: ReadonlyArray<PluginEntry> = [demoMotion, faceDetection, map3d, objectDetection, personDetection];

/**
 * Hands Core the plugins that exist.
 */
export const registerBuiltInModules = (registry: ModuleRegistry): void => {
  for (const entry of entries) registry.register(entry);
};
