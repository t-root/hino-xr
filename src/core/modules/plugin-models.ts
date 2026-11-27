import { ENV } from "@/env";

export const pluginModelUrl = (pluginId: string, file: string): string =>
  `${ENV.BASE_URL}plugins/${encodeURIComponent(pluginId)}/models/${encodeURIComponent(file)}`;
