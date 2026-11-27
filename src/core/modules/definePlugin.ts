import type { ModuleRegistration } from "./module-registry";

export type PluginEntry = ModuleRegistration;

export const definePlugin = (entry: PluginEntry): PluginEntry => entry;
