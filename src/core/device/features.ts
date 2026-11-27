const DEVICE_FEATURES = [
  "orientation",
  "motion",
  "accelerometer",
  "gyroscope",
  "magnetometer",
  "ambient-light-sensor",
  "geolocation",
  "wake-lock",
  "camera",
  "microphone",
  "notifications",
  "persistent-storage",
  "midi",
  "clipboard-read",
  "clipboard-write",
  "storage-access",
  "idle-detection",
  "window-management",
  "local-fonts",
  "nfc",
  "xr-spatial-tracking",
  "push",
  "speaker-selection",
  "display-capture",
  "bluetooth",
  "usb",
  "hid",
  "serial",
  "background-sync",
  "background-fetch",
  "compute-pressure",
] as const;

export type DeviceFeatureId = (typeof DEVICE_FEATURES)[number];

export type DeviceGrant = "prompt" | "granted" | "denied" | "unavailable";

export type DeviceGrants = Readonly<Record<DeviceFeatureId, DeviceGrant>>;

export const INITIAL_DEVICE_GRANTS: DeviceGrants = Object.fromEntries(
  DEVICE_FEATURES.map((id) => [id, "prompt" as const]),
) as DeviceGrants;

export const hasOrientationGrant = (grants: DeviceGrants): boolean =>
  grants.orientation === "granted" ||
  grants.motion === "granted" ||
  grants.accelerometer === "granted";
