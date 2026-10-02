import { message } from "@/i18n/text";
import { LocalizedError } from "@/shared/errors/localized";
import type { EventBus } from "../events/EventBus";
import type { RuntimeEvents } from "../events/events";
import { createLogger } from "../observability/diagnostics";
import { pickWorldCamera } from "./pickWorldCamera";
import type { CameraRequest, CameraSource } from "./types";

export const DEFAULT_CAMERA_REQUEST: CameraRequest = {
  facing: "environment",
  width: 1280,
  height: 720,
  fps: 30,
};

/**
 * Sole owner of the camera `MediaStream`. Modules never call `getUserMedia`
 * for video; they receive frames through the `FrameHub`. The microphone used
 * while talking to the assistant is opened separately, only for that hold.
 *
 * The stream is always the widest world-facing camera the phone will give, at
 * that camera's minimum zoom. Lens sliders never change this request.
 */
export class CameraController {
  private readonly logger;
  private source: CameraSource | null = null;
  private stopping = false;

  constructor(private readonly bus: EventBus<RuntimeEvents>) {
    this.logger = createLogger("camera", bus);
  }

  get current(): CameraSource | null {
    return this.source;
  }

  async listVideoDevices(): Promise<readonly MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "videoinput");
  }

  async start(request: CameraRequest = DEFAULT_CAMERA_REQUEST): Promise<CameraSource> {
    if (this.source) return this.source;

    this.bus.emit("camera.state", { state: "requesting" });

    try {
      const stream = await this.openWidest(request);
      const video = document.createElement("video");
      video.srcObject = stream;
      video.playsInline = true;
      video.muted = true;
      video.autoplay = true;
      await video.play();
      await waitForMetadata(video);

      const track = stream.getVideoTracks()[0];
      widenView(track);
      const settings = track?.getSettings() ?? {};
      const facing = (settings.facingMode as CameraSource["facing"] | undefined) ?? request.facing;

      this.source = {
        video,
        stream,
        deviceLabel: track?.label ?? "camera",
        facing,
        mirrored: facing === "user",
        width: video.videoWidth || request.width,
        height: video.videoHeight || request.height,
      };

      track?.addEventListener("ended", () => {
        if (this.stopping) return;
        this.logger.warn("camera track ended unexpectedly");
        this.stop();
        this.bus.emit("camera.state", {
          state: "error",
          error: new LocalizedError(message("camera.error.trackEnded")),
        });
      });

      this.bus.emit("camera.state", { state: "ready", deviceLabel: this.source.deviceLabel });
      return this.source;
    } catch (cause) {
      const error = normaliseCameraError(cause);
      this.logger.error("camera start failed", { name: error.name });
      this.bus.emit("camera.state", { state: "error", error });
      throw error;
    }
  }

  stop(): void {
    if (!this.source) return;
    this.stopping = true;
    for (const track of this.source.stream.getTracks()) track.stop();
    this.source.video.srcObject = null;
    this.source = null;
    this.stopping = false;
    this.bus.emit("camera.state", { state: "stopped" });
  }

  /**
   * Open the rear camera, then swap onto the widest labelled one if the
   * browser first handed over a telephoto.
   */
  private async openWidest(request: CameraRequest): Promise<MediaStream> {
    const first = await openStream(request, request.deviceId);
    if (request.deviceId) return first;

    const currentId = first.getVideoTracks()[0]?.getSettings().deviceId;
    const preferredId = pickWorldCamera(await this.listVideoDevices());
    if (!preferredId || preferredId === currentId) return first;

    for (const track of first.getTracks()) track.stop();
    try {
      return await openStream(request, preferredId);
    } catch {
      return currentId ? openStream(request, currentId) : openStream(request);
    }
  }
}

const openStream = async (request: CameraRequest, deviceId?: string): Promise<MediaStream> => {
  const facing = request.facing === "user" ? "user" : "environment";
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing } }),
      width: { ideal: request.width },
      height: { ideal: request.height },
      frameRate: { ideal: request.fps },
    },
  });
};

const waitForMetadata = (video: HTMLVideoElement): Promise<void> =>
  video.readyState >= HTMLMediaElement.HAVE_METADATA
    ? Promise.resolve()
    : new Promise((resolve) => video.addEventListener("loadedmetadata", () => resolve(), { once: true }));

/** Pulls the lens out to its widest zoom when the phone exposes that control. */
const widenView = (track: MediaStreamTrack | undefined): void => {
  if (!track?.getCapabilities) return;
  const zoom = track.getCapabilities().zoom;
  const min = zoom && typeof zoom.min === "number" ? zoom.min : undefined;
  if (min === undefined) return;
  void track.applyConstraints({ advanced: [{ zoom: min }] }).catch(() => undefined);
};

/**
 * Turns whatever `getUserMedia` rejected with into something worth reading.
 *
 * The browser's own wording is short, technical and in the browser's language,
 * and the difference between "denied", "already in use" and "no such camera" is
 * the whole difference between what the person should do next.
 */
const normaliseCameraError = (cause: unknown): Error => {
  if (!(cause instanceof Error)) return new LocalizedError(message("camera.error.failed"));
  switch (cause.name) {
    case "NotAllowedError":
    case "SecurityError":
      return Object.assign(new LocalizedError(message("camera.error.denied")), { name: cause.name });
    case "NotFoundError":
    case "OverconstrainedError":
      return Object.assign(new LocalizedError(message("camera.error.notFound")), { name: cause.name });
    case "NotReadableError":
      return Object.assign(new LocalizedError(message("camera.error.busy")), { name: cause.name });
    default:
      return cause;
  }
};
