import type { ModuleManifest, ModulePermission } from "@/shared/contracts/vision";

/**
 * What every plugin gets simply by being installed.
 *
 * Frames are the reason the plugin system exists, and they never leave the
 * device: the manager hands over one downscaled bitmap, takes back a list of
 * boxes, and closes the bitmap. Nothing here needs asking about separately.
 */
const IMPLICIT: readonly ModulePermission[] = ["camera-frame"];

/**
 * Permissions granted by hand, per plugin id.
 *
 * This file is the deliberate exception to "a plugin is one folder". Discovery
 * picks up any folder that appears under `src/modules/`, so if a manifest could
 * grant its own permissions, dropping in a folder would be enough to start
 * sending frames off the device. Anything past `camera-frame` therefore has to
 * be written here, outside the plugin, where it shows up in review as a change
 * to Core rather than as one more file in a plugin.
 *
 * `network` means user data leaving the device — frames, crops, results. It is
 * not about fetching a model file from a pinned URL, which every local plugin
 * does. `snapshot` means keeping a still of the camera beyond the frame it was
 * given. `screen` means covering the whole session with the plugin's own
 * interface, rather than only returning boxes for Core to draw.
 */
const PERMISSION_GRANTS: Readonly<Record<string, readonly ModulePermission[]>> = {
  // Sends the area the wearer picks on the map to OpenStreetMap (tiles, then
  // buildings and roads there) and shows it on a screen of its own.
  map3d: ["network", "screen"],
};

/** Permissions a manifest asks for that nobody has granted it. */
export const missingPermissions = (manifest: ModuleManifest): readonly ModulePermission[] => {
  const granted = PERMISSION_GRANTS[manifest.id] ?? [];
  return manifest.permissions.filter(
    (permission) => !IMPLICIT.includes(permission) && !granted.includes(permission),
  );
};
