import { pluginModelUrl } from "@/core/modules/plugin-models";
import { objectDetectionManifest } from "./manifest";
import spec from "./models.json";

const file = spec.files[0]?.file;
if (!file) throw new Error("models.json has no on-device file");

export const OBJECT_MODEL_URL = pluginModelUrl(objectDetectionManifest.id, file);
