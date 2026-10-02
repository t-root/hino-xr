import type { EventBus } from "../events/EventBus";
import type { RuntimeEvents } from "../events/events";
import { createLogger, type Logger } from "../observability/diagnostics";
import { INITIAL_DEVICE_GRANTS, type DeviceFeatureId, type DeviceGrant, type DeviceGrants } from "./features";

type PermissionResult = "granted" | "denied";

type RequestableOrientation = {
  requestPermission?: () => Promise<PermissionResult>;
};

type GenericSensor = {
  start(): void;
  stop(): void;
};

type GenericSensorCtor = new (options?: { frequency?: number }) => GenericSensor;

type WakeLockSentinel = {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
  requestMIDIAccess?: (options?: { sysex?: boolean }) => Promise<unknown>;
  storage?: { persist?: () => Promise<boolean> };
  bluetooth?: unknown;
  hid?: unknown;
  serial?: unknown;
  usb?: unknown;
  xr?: unknown;
};

type IdleDetectorCtor = {
  requestPermission?: () => Promise<PermissionResult>;
  new (): { start: (options?: { threshold?: number }) => Promise<void> };
};

type NdefReaderCtor = new () => {
  scan: (options?: { signal?: AbortSignal }) => Promise<void>;
};

const GENERIC_SENSORS: Readonly<
  Record<
    "accelerometer" | "gyroscope" | "magnetometer" | "ambient-light-sensor",
    "Accelerometer" | "Gyroscope" | "Magnetometer" | "AmbientLightSensor"
  >
> = {
  accelerometer: "Accelerometer",
  gyroscope: "Gyroscope",
  magnetometer: "Magnetometer",
  "ambient-light-sensor": "AmbientLightSensor",
};

/**
 * Permissions API names that do not match the feature id, or that have no
 * prompt other than `query`.
 */
const QUERY_NAMES: Readonly<Partial<Record<DeviceFeatureId, string>>> = {
  "wake-lock": "screen-wake-lock",
  "ambient-light-sensor": "ambient-light-sensor",
  "clipboard-read": "clipboard-read",
  "clipboard-write": "clipboard-write",
  "idle-detection": "idle-detection",
  "window-management": "window-management",
  "xr-spatial-tracking": "xr-spatial-tracking",
  push: "push",
  "speaker-selection": "speaker-selection",
  "display-capture": "display-capture",
  bluetooth: "bluetooth",
  "background-sync": "background-sync",
  "background-fetch": "background-fetch",
  "compute-pressure": "compute-pressure",
  nfc: "nfc",
  midi: "midi",
  camera: "camera",
  microphone: "microphone",
  geolocation: "geolocation",
  notifications: "notifications",
  "persistent-storage": "persistent-storage",
  "storage-access": "storage-access",
  accelerometer: "accelerometer",
  gyroscope: "gyroscope",
  magnetometer: "magnetometer",
};

/**
 * Asks for every browser permission that can be granted from a tap.
 *
 * Constructors and `requestPermission` / `getUserMedia` / `readText` calls are
 * fired in this turn of the stack, before any `await` that would spend the
 * user gesture. Camera and microphone are opened only long enough to obtain
 * the grant, then the tracks are stopped: the real camera belongs to
 * `CameraController`. Coordinates, clipboard text and font lists are thrown
 * away.
 *
 * Pickers are never opened. A Bluetooth/USB/screen-share dialog is not a
 * permission prompt, and putting one on Start would block the session.
 */
export class DeviceAccess {
  private grants: DeviceGrants = INITIAL_DEVICE_GRANTS;
  private wakeLock: WakeLockSentinel | null = null;
  private readonly logger: Logger;
  private readonly onGrants: (grants: DeviceGrants) => void;
  private visibilityHandler: (() => void) | null = null;
  private claimed = false;

  constructor(bus: EventBus<RuntimeEvents>, onGrants: (grants: DeviceGrants) => void) {
    this.logger = createLogger("device", bus);
    this.onGrants = onGrants;
  }

  get current(): DeviceGrants {
    return this.grants;
  }

  /**
   * Must be called from the Start tap, and before `await`ing fullscreen or
   * the camera: those consume the gesture on iOS, and a later prompt is
   * silently denied.
   */
  claimFromUserGesture(): Promise<DeviceGrants> {
    if (this.claimed) return Promise.resolve(this.grants);
    this.claimed = true;

    const tasks: Array<Promise<void>> = [];
    const start = (id: DeviceFeatureId, work: Promise<DeviceGrant>) => {
      tasks.push(
        work.then((grant) => {
          this.patch({ [id]: grant });
        }),
      );
    };

    // Fired in this turn, not after a then: the gesture is still live.
    start("orientation", requestIosSensorPermission(globalCtor("DeviceOrientationEvent")));
    start("motion", requestIosSensorPermission(globalCtor("DeviceMotionEvent")));
    start("accelerometer", requestGenericSensor("accelerometer"));
    start("gyroscope", requestGenericSensor("gyroscope"));
    start("magnetometer", requestGenericSensor("magnetometer"));
    start("ambient-light-sensor", requestGenericSensor("ambient-light-sensor"));
    start("wake-lock", this.requestWakeLock());
    start("geolocation", requestGeolocation(this.logger));
    start("notifications", requestNotifications());
    start("persistent-storage", requestPersistentStorage());
    start("midi", requestMidi());
    start("clipboard-read", requestClipboardRead());
    start("clipboard-write", queryNamed("clipboard-write"));
    start("storage-access", requestStorageAccess());
    start("idle-detection", requestIdleDetection());
    start("window-management", requestWindowManagement());
    start("local-fonts", requestLocalFonts());
    start("nfc", requestNfc());
    start("xr-spatial-tracking", queryNamed("xr-spatial-tracking"));
    start("push", queryNamed("push"));
    start("speaker-selection", queryNamed("speaker-selection"));
    start("display-capture", queryNamed("display-capture"));
    start("bluetooth", queryNamed("bluetooth"));
    start("usb", queryNamed("usb"));
    start("hid", queryNamed("hid"));
    start("serial", queryNamed("serial"));
    start("background-sync", queryNamed("background-sync"));
    start("background-fetch", queryNamed("background-fetch"));
    start("compute-pressure", queryNamed("compute-pressure"));

    const media = requestCameraAndMicrophone();
    tasks.push(
      media.then(({ camera, microphone }) => {
        this.patch({ camera, microphone });
      }),
    );

    return Promise.all(tasks).then(() => {
      this.watchVisibility();
      return this.grants;
    });
  }

  async dispose(): Promise<void> {
    if (this.visibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (this.wakeLock && !this.wakeLock.released) {
      try {
        await this.wakeLock.release();
      } catch {
        // Releasing on teardown is polite, not required.
      }
    }
    this.wakeLock = null;
  }

  private patch(next: Partial<DeviceGrants>): void {
    this.grants = { ...this.grants, ...next };
    this.onGrants(this.grants);
  }

  private async requestWakeLock(): Promise<DeviceGrant> {
    const nav = typeof navigator === "undefined" ? undefined : (navigator as WakeLockNavigator);
    if (!nav?.wakeLock) return "unavailable";
    try {
      this.wakeLock = await nav.wakeLock.request("screen");
      this.wakeLock.addEventListener("release", () => {
        this.wakeLock = null;
      });
      return "granted";
    } catch (cause) {
      if (isDenied(cause)) return "denied";
      this.logger.debug("wake lock unavailable", { name: cause instanceof Error ? cause.name : "unknown" });
      return "unavailable";
    }
  }

  private watchVisibility(): void {
    if (typeof document !== "undefined") {
      this.visibilityHandler = () => {
        if (document.visibilityState !== "visible") return;
        if (this.grants["wake-lock"] !== "granted") return;
        if (this.wakeLock && !this.wakeLock.released) return;
        void this.requestWakeLock().then((grant) => this.patch({ "wake-lock": grant }));
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
    }
  }
}

const globalCtor = (name: string): unknown =>
  typeof globalThis === "undefined" ? undefined : (globalThis as unknown as Record<string, unknown>)[name];

const isDenied = (cause: unknown): boolean =>
  cause instanceof DOMException && (cause.name === "NotAllowedError" || cause.name === "SecurityError");

const requestIosSensorPermission = (ctor: unknown): Promise<DeviceGrant> => {
  if (ctor === undefined || ctor === null || typeof ctor !== "object") return Promise.resolve("unavailable");
  const request = (ctor as RequestableOrientation).requestPermission;
  if (typeof request !== "function") return Promise.resolve("granted");
  return request
    .call(ctor)
    .then((result) => (result === "granted" ? "granted" : "denied"))
    .catch(() => "denied" as const);
};

const requestGenericSensor = async (
  feature: "accelerometer" | "gyroscope" | "magnetometer" | "ambient-light-sensor",
): Promise<DeviceGrant> => {
  const ctorName = GENERIC_SENSORS[feature];
  const Ctor = globalCtor(ctorName) as GenericSensorCtor | undefined;
  if (typeof Ctor !== "function") return queryNamed(feature);
  try {
    const sensor = new Ctor({ frequency: 1 });
    sensor.start();
    sensor.stop();
    return "granted";
  } catch (cause) {
    if (isDenied(cause)) return "denied";
    if (cause instanceof DOMException && cause.name === "NotSupportedError") return "unavailable";
    return queryNamed(feature);
  }
};

const requestGeolocation = (logger: Logger): Promise<DeviceGrant> =>
  new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve("unavailable");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      () => resolve("granted"),
      (error) => {
        const denied = error.code === error.PERMISSION_DENIED;
        if (!denied) logger.debug("geolocation granted but no fix", { code: error.code });
        resolve(denied ? "denied" : "granted");
      },
      { enableHighAccuracy: false, maximumAge: Infinity, timeout: 2_000 },
    );
  });

const stopStream = (stream: MediaStream): void => {
  for (const track of stream.getTracks()) track.stop();
};

const requestMedia = async (constraints: MediaStreamConstraints): Promise<DeviceGrant> => {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return "unavailable";
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    stopStream(stream);
    return "granted";
  } catch (cause) {
    if (isDenied(cause)) return "denied";
    if (cause instanceof DOMException && (cause.name === "NotFoundError" || cause.name === "OverconstrainedError")) {
      return "unavailable";
    }
    return "unavailable";
  }
};

const requestCameraAndMicrophone = async (): Promise<{ camera: DeviceGrant; microphone: DeviceGrant }> => {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return { camera: "unavailable", microphone: "unavailable" };
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    stopStream(stream);
    return { camera: "granted", microphone: "granted" };
  } catch {
    const camera = await requestMedia({ video: true });
    const microphone = await requestMedia({ audio: true });
    return { camera, microphone };
  }
};

const requestNotifications = async (): Promise<DeviceGrant> => {
  if (typeof Notification === "undefined" || typeof Notification.requestPermission !== "function") {
    return "unavailable";
  }
  try {
    const result = await Notification.requestPermission();
    if (result === "granted") return "granted";
    if (result === "denied") return "denied";
    return "unavailable";
  } catch (cause) {
    return isDenied(cause) ? "denied" : "unavailable";
  }
};

const requestPersistentStorage = async (): Promise<DeviceGrant> => {
  if (typeof navigator === "undefined" || typeof navigator.storage?.persist !== "function") {
    return queryNamed("persistent-storage");
  }
  try {
    return (await navigator.storage.persist()) ? "granted" : "denied";
  } catch (cause) {
    return isDenied(cause) ? "denied" : "unavailable";
  }
};

const requestMidi = async (): Promise<DeviceGrant> => {
  const nav = typeof navigator === "undefined" ? undefined : (navigator as WakeLockNavigator);
  if (typeof nav?.requestMIDIAccess !== "function") return queryNamed("midi");
  try {
    await nav.requestMIDIAccess({ sysex: false });
    return "granted";
  } catch (cause) {
    return isDenied(cause) ? "denied" : "unavailable";
  }
};

const requestClipboardRead = async (): Promise<DeviceGrant> => {
  if (typeof navigator === "undefined" || !navigator.clipboard?.readText) return queryNamed("clipboard-read");
  try {
    await navigator.clipboard.readText();
    return "granted";
  } catch (cause) {
    if (isDenied(cause)) return "denied";
    // An empty or blocked clipboard is still a grant on some browsers.
    return queryNamed("clipboard-read");
  }
};

const requestStorageAccess = async (): Promise<DeviceGrant> => {
  if (typeof document === "undefined" || typeof document.requestStorageAccess !== "function") {
    return queryNamed("storage-access");
  }
  try {
    await document.requestStorageAccess();
    return "granted";
  } catch (cause) {
    return isDenied(cause) ? "denied" : "unavailable";
  }
};

const requestIdleDetection = async (): Promise<DeviceGrant> => {
  const Idle = globalCtor("IdleDetector") as IdleDetectorCtor | undefined;
  if (typeof Idle?.requestPermission === "function") {
    try {
      const result = await Idle.requestPermission();
      return result === "granted" ? "granted" : "denied";
    } catch (cause) {
      return isDenied(cause) ? "denied" : "unavailable";
    }
  }
  return queryNamed("idle-detection");
};

const requestWindowManagement = async (): Promise<DeviceGrant> => {
  const getScreenDetails = (globalThis as unknown as { getScreenDetails?: () => Promise<unknown> }).getScreenDetails;
  if (typeof getScreenDetails !== "function") return queryNamed("window-management");
  try {
    await getScreenDetails();
    return "granted";
  } catch (cause) {
    return isDenied(cause) ? "denied" : "unavailable";
  }
};

const requestLocalFonts = async (): Promise<DeviceGrant> => {
  const queryLocalFonts = (globalThis as unknown as { queryLocalFonts?: () => Promise<unknown> }).queryLocalFonts;
  if (typeof queryLocalFonts !== "function") return queryNamed("local-fonts");
  try {
    await queryLocalFonts();
    return "granted";
  } catch (cause) {
    return isDenied(cause) ? "denied" : "unavailable";
  }
};

const requestNfc = async (): Promise<DeviceGrant> => {
  const Ctor = globalCtor("NDEFReader") as NdefReaderCtor | undefined;
  if (typeof Ctor !== "function") return queryNamed("nfc");
  const abort = new AbortController();
  try {
    await new Ctor().scan({ signal: abort.signal });
    abort.abort();
    return "granted";
  } catch (cause) {
    abort.abort();
    if (isDenied(cause)) return "denied";
    if (cause instanceof DOMException && cause.name === "AbortError") return "granted";
    return queryNamed("nfc");
  }
};

const queryNamed = async (id: DeviceFeatureId): Promise<DeviceGrant> => {
  const name = QUERY_NAMES[id] ?? id;
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unavailable";
  try {
    const status = await navigator.permissions.query({ name } as PermissionDescriptor);
    if (status.state === "granted") return "granted";
    if (status.state === "denied") return "denied";
    return "unavailable";
  } catch {
    return "unavailable";
  }
};
