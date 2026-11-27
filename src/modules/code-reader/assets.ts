import { pluginModelUrl } from "@/core/modules/plugin-models";
import { codeReaderManifest } from "./manifest";
import spec from "./models.json";

const urlOf = (file: string): string => {
  if (!spec.files.some((item) => item.file === file)) throw new Error(`models.json does not declare ${file}`);
  return pluginModelUrl(codeReaderManifest.id, file);
};

export const READER_WASM_URL = urlOf("zxing_reader.wasm");

export const READER_SCRIPT_URL = urlOf("zxing-reader.iife.js");
