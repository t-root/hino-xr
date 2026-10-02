import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { HandFrame, Handedness } from "@/shared/contracts/input";
import type { FramePacket } from "@/shared/contracts/vision";
import { ASSETS } from "../config";
import type { FrameConsumer } from "../camera/types";
import type { EventBus } from "../events/EventBus";
import type { RuntimeEvents } from "../events/events";
import { createLogger } from "../observability/diagnostics";
import type { Metrics } from "../observability/metrics";

export type HandTrackingStatus = "idle" | "loading" | "ready" | "failed" | "unsupported";

/**
 * Hand landmarks are Core input, not a plugin: they arrive through the shared
 * FrameHub quota like every other consumer, and the result is published on the
 * bus for the interaction layer.
 */
export class HandTrackingService {
  private landmarker: HandLandmarker | null = null;
  private status: HandTrackingStatus = "idle";
  private lastTimestampMs = 0;
  private readonly logger;
  private listener: ((hands: readonly HandFrame[]) => void) | null = null;

  constructor(
    bus: EventBus<RuntimeEvents>,
    private readonly metrics: Metrics,
  ) {
    this.logger = createLogger("hand-tracking", bus);
  }

  onHands(listener: (hands: readonly HandFrame[]) => void): void {
    this.listener = listener;
  }

  async initialize(): Promise<HandTrackingStatus> {
    if (this.status === "ready" || this.status === "loading") return this.status;
    this.status = "loading";
    try {
      const fileset = await FilesetResolver.forVisionTasks(ASSETS.wasmBase);
      this.landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: ASSETS.handLandmarker, delegate: "GPU" },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
      this.status = "ready";
    } catch (error) {
      this.status = "failed";
      this.logger.error("hand landmarker failed to load", { message: (error as Error).message });
    }
    return this.status;
  }

  /** Frame consumer registered with the hub; owns and closes each bitmap. */
  createConsumer(preferredFps: number): FrameConsumer {
    return {
      id: "core.hand-tracking",
      preferredFps,
      maxSize: 320,
      onFrame: (packet) => this.process(packet),
    };
  }

  private process(packet: FramePacket): void {
    const landmarker = this.landmarker;
    if (!landmarker || this.status !== "ready") {
      packet.image.close();
      return;
    }
    // MediaPipe requires strictly increasing timestamps in VIDEO mode.
    const timestamp = Math.max(Math.round(packet.timestampMs), this.lastTimestampMs + 1);
    this.lastTimestampMs = timestamp;

    const started = performance.now();
    try {
      const result = landmarker.detectForVideo(packet.image, timestamp);
      this.metrics.timing("hand.inference", performance.now() - started);
      this.listener?.(toHandFrames(result, packet));
    } catch (error) {
      this.logger.warn("hand inference failed", { message: (error as Error).message });
    } finally {
      packet.image.close();
    }
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.status = "idle";
    this.listener = null;
  }
}

type LandmarkerResult = {
  landmarks: { x: number; y: number; z: number }[][];
  handedness: { categoryName: string; score: number }[][];
};

const toHandFrames = (result: LandmarkerResult, packet: FramePacket): readonly HandFrame[] => {
  const frames: HandFrame[] = [];
  for (let index = 0; index < result.landmarks.length; index += 1) {
    const landmarks = result.landmarks[index];
    if (!landmarks || landmarks.length === 0) continue;
    const category = result.handedness[index]?.[0];
    // MediaPipe labels handedness as if the image were mirrored, so a
    // non-mirrored (rear camera) frame reports the opposite hand.
    const reported = category?.categoryName === "Left" ? "left" : "right";
    const hand: Handedness = packet.mirrored ? reported : reported === "left" ? "right" : "left";
    frames.push({
      hand,
      landmarks: landmarks.map((point) => ({ x: point.x, y: point.y, z: point.z })),
      confidence: category?.score ?? 0,
      timestampMs: packet.timestampMs,
    });
  }
  return frames;
};
