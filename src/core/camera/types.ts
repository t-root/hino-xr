import type { FramePacket } from "@/shared/contracts/vision";

type CameraFacing = "user" | "environment";

export type CameraRequest = Readonly<{
  facing: CameraFacing;
  deviceId?: string;
  width: number;
  height: number;
  fps: number;
}>;

export type CameraSource = Readonly<{
  video: HTMLVideoElement;
  stream: MediaStream;
  deviceLabel: string;
  facing: CameraFacing;
  /** True when the image must be mirrored for a natural selfie view. */
  mirrored: boolean;
  width: number;
  height: number;
}>;

/**
 * A frame consumer. Every consumer has an independent quota and a queue depth of
 * one: while `onFrame` is pending, newer frames are dropped rather than queued.
 */
export type FrameConsumer = Readonly<{
  id: string;
  preferredFps: number;
  /** Longest edge of the analysis image this consumer wants. */
  maxSize?: number;
  onFrame: (packet: FramePacket) => Promise<void> | void;
}>;
