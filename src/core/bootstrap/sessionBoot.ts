import type { HandTrackingStatus } from "../input/HandTrackingService";
import type { CameraState } from "../events/events";
import type { Settings } from "../state/settings";
import type { AssistantSnapshot } from "@/shared/contracts/model";

type SessionBootInput = Readonly<{
  cameraState: CameraState;
  handStatus: HandTrackingStatus;
  assistant: Pick<AssistantSnapshot, "state" | "voice" | "greeted">;
  settings: Pick<Settings, "flags" | "assistant">;
}>;

export type SessionBootStep = "camera" | "hands" | "assistant" | "voice" | "ready";

/**
 * Camera, hands, GGUF, then HINO's first spoken line. Plugin detectors stay
 * out of this list. The world stays black until `ready`.
 */
export const sessionBootStep = (input: SessionBootInput): SessionBootStep => {
  if (input.cameraState !== "ready") return "camera";
  if (input.settings.flags.handTracking && (input.handStatus === "idle" || input.handStatus === "loading")) {
    return "hands";
  }
  if (!input.settings.assistant.enabled) return "ready";
  const { state, greeted } = input.assistant;
  if (state === "speaking") return "ready";
  if (state === "failed" || state === "offline") return "ready";
  if (state === "ready" && greeted) return "ready";
  if (state === "generating") return "voice";
  return "assistant";
};

export const sessionBootReady = (input: SessionBootInput): boolean => sessionBootStep(input) === "ready";
