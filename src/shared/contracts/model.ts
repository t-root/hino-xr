/**
 * Language-model slots as the web is allowed to see them.
 *
 * Weights, tokenisers, chat templates, speech-to-text and text-to-speech live
 * on the Core model server. This file is only the JSON the bridge already speaks.
 */
export type ModelState =
  | "offline"
  | "idle"
  | "loading"
  | "ready"
  | "failed"
  | "generating"
  | "listening"
  | "speaking";

export type VoiceState = "idle" | "loading" | "ready" | "failed";

export type VoiceIssue = "tooShort" | "noMic" | "noSpeech";

type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = Readonly<{
  role: ChatRole;
  content: string;
}>;

export type ModelInfo = Readonly<{
  id: string;
  source: string;
  state: Exclude<ModelState, "offline" | "generating" | "listening" | "speaking">;
  device: string | null;
  error: string | null;
  voice?: VoiceState;
  voiceError?: string | null;
}>;

export type AssistantSnapshot = Readonly<{
  state: ModelState;
  id: string | null;
  source: string | null;
  device: string | null;
  error: string | null;
  voice: VoiceState;
  heard: string;
  reply: string;
  /** Turns shown in the headset. The live reply is the last assistant line while generating. */
  messages: readonly ChatMessage[];
  voiceIssue: VoiceIssue | null;
  catalog: readonly ModelInfo[];
  /** True after the first wake (or a failed wake). Load-to-ready is not a greeting. */
  greeted: boolean;
}>;

export const EMPTY_ASSISTANT: AssistantSnapshot = {
  state: "offline",
  id: null,
  source: null,
  device: null,
  error: null,
  voice: "idle",
  heard: "",
  reply: "",
  messages: [],
  voiceIssue: null,
  catalog: [],
  greeted: false,
};
