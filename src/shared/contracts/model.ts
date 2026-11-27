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
  messages: readonly ChatMessage[];
  voiceIssue: VoiceIssue | null;
  catalog: readonly ModelInfo[];
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
