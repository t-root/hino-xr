import type { ModuleRegistration } from "./module-registry";

/**
 * What a plugin folder exports, and the only thing Core needs from it.
 *
 * `manifest` is read at start-up to list the plugin; `load` runs the first time
 * it is switched on. Keeping them apart is what lets a folder announce itself
 * without its model, its worker or its dependencies being fetched.
 */
export type PluginEntry = ModuleRegistration;

/**
 * Declares a plugin. Every folder under `src/modules/` has a `plugin.ts` whose
 * default export is one of these, and that file is all Core looks for: adding a
 * plugin is adding a folder, with no edit anywhere else in the tree.
 *
 * Everything the plugin owns lives in that folder, written small:
 *
 * - `plugin.ts` — this declaration (manifest + a lazy `import()`, nothing else)
 * - `manifest.ts`, `text.json` — identity and copy
 * - `models.json` — optional; on-device files to fetch and GGUF slots
 * - worker, mapping, thresholds, `assets.ts` — whatever inference needs
 *
 * A model is not an exception. If a plugin needs weights, it names them in its
 * own `models.json`. Core does not grow a list of plugin models.
 *
 * The one exception is permissions. A folder cannot hand itself `network` or
 * `snapshot` by declaring them here — those are granted by hand in
 * `permissions.ts`, outside the plugin, or the plugin refuses to start.
 */
export const definePlugin = (entry: PluginEntry): PluginEntry => entry;
