import { pluginModelUrl } from "@/core/modules/plugin-models";
import { personDetectionManifest } from "./manifest";
import spec from "./models.json";

const file = spec.files[0]?.file;
if (!file) throw new Error("models.json has no on-device file");

export const PERSON_MODEL_URL = pluginModelUrl(personDetectionManifest.id, file);
