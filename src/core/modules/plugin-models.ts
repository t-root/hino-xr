/**
 * What a plugin folder may declare in `models.json`.
 *
 * The file is optional. A plugin with no weights has nothing to write. Core
 * never names a plugin's model: Python fetches `files` into the plugin's own
 * `models/` folder, and the model server may load `slots` that are local GGUF
 * causal LMs. Anything else a plugin needs — worker, mapping, thresholds,
 * copy — stays in the same folder.
 */
import { ENV } from "@/env";

/**
 * URL of a file a plugin declared in its `models.json`. Python keeps it in
 * that plugin's own folder (`src/modules/<id>/models/`) and serves it from
 * there; nothing of a plugin's is put where other plugins' files live.
 */
export const pluginModelUrl = (pluginId: string, file: string): string =>
  `${ENV.BASE_URL}plugins/${encodeURIComponent(pluginId)}/models/${encodeURIComponent(file)}`;
