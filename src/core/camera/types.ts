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
  mirrored: boolean;
  width: number;
  height: number;
}>;

export type FrameConsumer = Readonly<{
  id: string;
  preferredFps: number;
  maxSize?: number;
  onFrame: (packet: FramePacket) => Promise<void> | void;
}>;
