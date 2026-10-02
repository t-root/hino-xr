import type { LocalizedText } from "./locale";
import type { ModulePermission, ModuleState } from "./vision";

export type PluginPaletteItemState = "available" | ModuleState;

export type PluginPaletteItem = Readonly<{
  id: string;
  /** Straight from the manifest; whoever draws it picks the language. */
  title: LocalizedText;
  description: LocalizedText;
  state: PluginPaletteItemState;
  capabilities: readonly string[];
  permissions: readonly ModulePermission[];
  canConfigure: boolean;
  enabled: boolean;
}>;

export interface PluginPaletteController {
  items(): readonly PluginPaletteItem[];
}
