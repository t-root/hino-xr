import type { FramePacket, FrameRotation } from "@/shared/contracts/vision";
import type { Unsubscribe } from "../events/EventBus";
import type { EventBus } from "../events/EventBus";
import type { RuntimeEvents } from "../events/events";
import type { Metrics } from "../observability/metrics";
import { FrameScheduler, type ConsumerTiming } from "./FrameScheduler";
import type { CameraSource, FrameConsumer } from "./types";

type Registration = {
  readonly consumer: FrameConsumer;
  readonly timing: ConsumerTiming;
};

type FrameHubOptions = Readonly<{
  analysisMaxSize: number;
  metrics: Metrics;
}>;

/**
 * Single source of frames. It samples the camera at display rate, then hands
 * downscaled `ImageBitmap`s to the consumers whose quota is due.
 *
 * Ownership rule: a consumer owns the bitmap it receives and must `close()` it
 * or transfer it to a worker that does. The hub never reuses a bitmap.
 */
export class FrameHub {
  private readonly scheduler = new FrameScheduler();
  private readonly registrations = new Map<string, Registration>();
  private source: CameraSource | null = null;
  private running = false;
  private frameId = 0;
  private rafHandle = 0;
  private videoCallbackHandle = 0;
  private analysisMaxSize: number;
  private readonly metrics: Metrics;
  private rotationDeg: FrameRotation = 0;
  private mirrored = false;

  constructor(
    private readonly bus: EventBus<RuntimeEvents>,
    options: FrameHubOptions,
  ) {
    this.analysisMaxSize = options.analysisMaxSize;
    this.metrics = options.metrics;
  }

  setAnalysisMaxSize(size: number): void {
    this.analysisMaxSize = Math.max(128, Math.round(size));
  }

  setLoad(renderFps: number, visible: boolean): void {
    this.scheduler.setLoad({ renderFps, visible });
  }

  registerConsumer(consumer: FrameConsumer): Unsubscribe {
    if (this.registrations.has(consumer.id)) {
      throw new Error(`Frame consumer "${consumer.id}" is already registered`);
    }
    this.registrations.set(consumer.id, {
      consumer,
      timing: {
        id: consumer.id,
        preferredFps: consumer.preferredFps,
        lastDispatchMs: 0,
        busy: false,
      },
    });
    return () => {
      this.registrations.delete(consumer.id);
    };
  }

  attach(source: CameraSource): void {
    this.source = source;
    this.frameId = 0;
    this.mirrored = source.mirrored;
  }

  setOrientation(orientation: Readonly<{ rotationDeg: FrameRotation; mirrored: boolean }>): void {
    this.rotationDeg = orientation.rotationDeg;
    this.mirrored = orientation.mirrored;
  }

  start(): void {
    if (this.running || !this.source) return;
    this.running = true;
    this.scheduleNextTick();
  }

  stop(): void {
    this.running = false;
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    const video = this.source?.video as VideoWithFrameCallback | undefined;
    if (this.videoCallbackHandle && video?.cancelVideoFrameCallback) {
      video.cancelVideoFrameCallback(this.videoCallbackHandle);
    }
    this.rafHandle = 0;
    this.videoCallbackHandle = 0;
    this.source = null;
  }

  private scheduleNextTick(): void {
    if (!this.running || !this.source) return;
    const video = this.source.video as VideoWithFrameCallback;
    if (typeof video.requestVideoFrameCallback === "function") {
      this.videoCallbackHandle = video.requestVideoFrameCallback(() => {
        void this.tick();
      });
    } else {
      this.rafHandle = requestAnimationFrame(() => {
        void this.tick();
      });
    }
  }

  private async tick(): Promise<void> {
    if (!this.running || !this.source) return;
    const now = performance.now();
    const video = this.source.video;

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      this.frameId += 1;
      const frameId = this.frameId;
      this.bus.emit("frame.available", {
        frameId,
        timestampMs: now,
        width: video.videoWidth,
        height: video.videoHeight,
      });

      for (const entry of this.registrations.values()) {
        if (!this.scheduler.shouldDispatch(entry.timing, now)) continue;
        entry.timing.busy = true;
        entry.timing.lastDispatchMs = now;
        void this.dispatch(entry, frameId, now);
      }
    }

    this.scheduleNextTick();
  }

  private async dispatch(entry: Registration, frameId: number, timestampMs: number): Promise<void> {
    const source = this.source;
    if (!source) {
      entry.timing.busy = false;
      return;
    }

    try {
      const maxSize = entry.consumer.maxSize ?? this.analysisMaxSize;
      const { width, height } = fitWithin(source.video.videoWidth, source.video.videoHeight, maxSize);
      const image = await createImageBitmap(source.video, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: "medium",
      });

      const packet: FramePacket = {
        id: frameId,
        timestampMs,
        image,
        width,
        height,
        rotationDeg: this.rotationDeg,
        mirrored: this.mirrored,
      };

      await entry.consumer.onFrame(packet);
      this.metrics.timing(`frame.consumer.${entry.consumer.id}`, performance.now() - timestampMs);
    } catch (error) {
      this.bus.emit("diagnostic", {
        level: "warn",
        scope: "frame-hub",
        message: `consumer ${entry.consumer.id} failed: ${(error as Error).message}`,
      });
    } finally {
      entry.timing.busy = false;
    }
  }
}

type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/** Contain-fit that keeps the aspect ratio and never upscales. */
const fitWithin = (
  width: number,
  height: number,
  maxSize: number,
): { width: number; height: number } => {
  const longest = Math.max(width, height);
  if (longest <= maxSize || longest === 0) return { width, height };
  const scale = maxSize / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};
