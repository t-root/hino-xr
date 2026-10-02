/**
 * Device features Core asks the browser for on Start.
 *
 * The prompt has to run inside that tap — iOS in particular refuses later —
 * so everything that can be granted from a gesture is listed here even if the
 * session will not read it yet. Asking later would have spent the gesture on
 * the camera and fullscreen.
 *
 * APIs that open a device or screen picker (Bluetooth, USB, HID, serial,
 * display-capture, audio-output, WebXR session) are queried, never fired:
 * those dialogs are not permission grants, they are "pick a device".
 */
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

/** Outcome of one prompt. `prompt` is only the value before anyone has asked. */
export type DeviceGrant = "prompt" | "granted" | "denied" | "unavailable";

export type DeviceGrants = Readonly<Record<DeviceFeatureId, DeviceGrant>>;

export const INITIAL_DEVICE_GRANTS: DeviceGrants = Object.fromEntries(
  DEVICE_FEATURES.map((id) => [id, "prompt" as const]),
) as DeviceGrants;

/** True when any of the heading sensors can drive auto-rotate. */
export const hasOrientationGrant = (grants: DeviceGrants): boolean =>
  grants.orientation === "granted" ||
  grants.motion === "granted" ||
  grants.accelerometer === "granted";
