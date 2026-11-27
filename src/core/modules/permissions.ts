import type { ModuleManifest, ModulePermission } from "@/shared/contracts/vision";

const IMPLICIT: readonly ModulePermission[] = ["camera-frame"];

const PERMISSION_GRANTS: Readonly<Record<string, readonly ModulePermission[]>> = {
  map3d: ["network", "screen"],
  "face-recognition": ["network", "screen"],
};

const ASSISTANT_PLUGIN_PREFIX = "ai-";

export const missingPermissions = (manifest: ModuleManifest): readonly ModulePermission[] => {
  if (manifest.id.startsWith(ASSISTANT_PLUGIN_PREFIX)) return [];
  const granted = PERMISSION_GRANTS[manifest.id] ?? [];
  return manifest.permissions.filter(
    (permission) => !IMPLICIT.includes(permission) && !granted.includes(permission),
  );
};
