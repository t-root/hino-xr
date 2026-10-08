import { MODEL_API } from "@/core/config";
import type { ChatMessage, ModelInfo } from "@/shared/contracts/model";
import { DEFAULT_VOICE, voiceQuery, type VoiceSettings } from "@/shared/contracts/voice";

type TalkResult = Readonly<{
  transcript: string;
  reply: string;
  /** Pieces of speech in the order they were said; also handed to `onAudio` as they arrive. */
  audio: readonly Blob[];
}>;

/**
 * HTTP only. No tokeniser, no chat template, no weights, no speech model:
 * those stay on the model server. A missing server is an empty list, not an
 * exception, so the headset UI can say "offline" instead of throwing through
 * the render loop.
 */
export class ModelClient {
  constructor(private readonly base: string = MODEL_API.replace(/\/$/, "")) {}

  async list(signal?: AbortSignal): Promise<readonly ModelInfo[]> {
    const response = await this.send(this.base, init(signal));
    if (!response?.ok) return [];
    const body = (await response.json()) as { models?: ModelInfo[] };
    return body.models ?? [];
  }

  async load(id: string, signal?: AbortSignal): Promise<ModelInfo | "offline"> {
    const response = await this.send(`${this.base}/${encodeURIComponent(id)}/load`, {
      method: "POST",
      ...init(signal),
    });
    if (!response) return "offline";
    if (!response.ok) {
      const detail = await readDetail(response);
      throw new Error(detail);
    }
    return (await response.json()) as ModelInfo;
  }

  async complete(
    id: string,
    messages: readonly ChatMessage[],
    onToken: (text: string) => void,
    signal?: AbortSignal,
    speak = false,
    locale = "vi",
    voice: VoiceSettings = DEFAULT_VOICE,
    onAudio?: (audio: Blob) => void,
  ): Promise<TalkResult> {
    const response = await this.send(`${this.base}/${encodeURIComponent(id)}/complete?${voiceQuery(voice)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ messages, maxTokens: 128, voice: speak, locale }),
      ...init(signal),
    });
    if (!response) throw new Error("offline");
    if (!response.ok || !response.body) throw new Error(await readDetail(response));
    return readSse(response.body, { onToken, onAudio }, signal);
  }

  async wake(
    id: string,
    locale: string,
    onToken: (text: string) => void,
    signal?: AbortSignal,
    onStatus?: (state: string) => void,
    voice: VoiceSettings = DEFAULT_VOICE,
    onAudio?: (audio: Blob) => void,
    greeting = "",
  ): Promise<TalkResult> {
    const response = await this.send(
      `${this.base}/${encodeURIComponent(id)}/wake?locale=${encodeURIComponent(locale)}&greeting=${encodeURIComponent(greeting)}&${voiceQuery(voice)}`,
      {
        method: "POST",
        headers: { Accept: "text/event-stream" },
        ...init(signal),
      },
    );
    if (!response) throw new Error("offline");
    if (!response.ok || !response.body) throw new Error(await readDetail(response));
    return readSse(response.body, { onToken, onStatus, onAudio }, signal);
  }

  async talk(
    id: string,
    wav: Blob,
    locale: string,
    onToken: (text: string) => void,
    onTranscript: (text: string) => void,
    signal?: AbortSignal,
    history: readonly ChatMessage[] = [],
    voice: VoiceSettings = DEFAULT_VOICE,
    onAudio?: (audio: Blob) => void,
    stripWake = false,
  ): Promise<TalkResult> {
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    let body: BodyInit = wav;
    if (history.length > 0) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({ audio: await blobToBase64(wav), messages: history });
    } else {
      headers["Content-Type"] = "audio/wav";
    }
    const response = await this.send(
      `${this.base}/${encodeURIComponent(id)}/talk?locale=${encodeURIComponent(locale)}&stripWake=${stripWake}&${voiceQuery(voice)}`,
      {
        method: "POST",
        headers,
        body,
        ...init(signal),
      },
    );
    if (!response) throw new Error("offline");
    if (!response.ok || !response.body) throw new Error(await readDetail(response));
    return readSse(response.body, { onToken, onTranscript, onAudio }, signal);
  }

  /**
   * Is this line the call that wakes the system ("system call") or the assistant
   * (its name)? `after` is how many words followed the call: more than a couple
   * means the question came with it.
   */
  async listen(
    wav: Blob,
    expect: "system" | "wake",
    locale: string,
    signal?: AbortSignal,
  ): Promise<Readonly<{ heard: string; matched: boolean; after: number }>> {
    const response = await this.send(
      `${this.voiceBase()}/listen?expect=${expect}&locale=${encodeURIComponent(locale)}`,
      { method: "POST", headers: { "Content-Type": "audio/wav" }, body: wav, ...init(signal) },
    );
    if (!response) throw new Error("offline");
    if (!response.ok) throw new Error(await readDetail(response));
    return (await response.json()) as { heard: string; matched: boolean; after: number };
  }

  private voiceBase(): string {
    return `${this.base.replace(/\/models$/, "")}/voice`;
  }

  /** One line spoken in the given voice, without the language model. */
  async preview(text: string, locale: string, voice: VoiceSettings, signal?: AbortSignal): Promise<Blob> {
    const response = await this.send(`${this.voiceBase()}/preview?${voiceQuery(voice)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, locale }),
      ...init(signal),
    });
    if (!response) throw new Error("offline");
    if (!response.ok) throw new Error(await readDetail(response));
    return response.blob();
  }

  private async send(url: string, init: RequestInit): Promise<Response | null> {
    try {
      return await fetch(url, init);
    } catch {
      return null;
    }
  }
}

const init = (signal?: AbortSignal): RequestInit => (signal ? { signal } : {});

const readDetail = async (response: Response): Promise<string> => {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    /* not JSON */
  }
  return `${response.status}`;
};

type SseHandlers = Readonly<{
  onToken?: (text: string) => void;
  onTranscript?: (text: string) => void;
  onStatus?: (state: string) => void;
  onAudio?: ((audio: Blob) => void) | undefined;
}>;

const readSse = async (
  body: ReadableStream<Uint8Array>,
  handlers: SseHandlers,
  signal?: AbortSignal,
): Promise<TalkResult> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  let transcript = "";
  const audio: Blob[] = [];
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel();
      break;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const data = chunk
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (!data) continue;
      let event: { type?: string; text?: string; error?: string; mime?: string; data?: string; state?: string };
      try {
        event = JSON.parse(data) as {
          type?: string;
          text?: string;
          error?: string;
          mime?: string;
          data?: string;
          state?: string;
        };
      } catch {
        continue;
      }
      if (event.type === "transcript" && event.text) {
        transcript = event.text;
        handlers.onTranscript?.(event.text);
      }
      if (event.type === "token" && event.text) {
        reply += event.text;
        handlers.onToken?.(event.text);
      }
      if (event.type === "audio" && event.data) {
        const piece = decodeAudio(event.data, event.mime ?? "audio/wav");
        audio.push(piece);
        handlers.onAudio?.(piece);
      }
      if (event.type === "status" && event.state) handlers.onStatus?.(event.state);
      if (event.type === "error" && event.error) throw new Error(event.error);
      if (event.type === "done") return { transcript, reply, audio };
    }
  }
  return { transcript, reply, audio };
};

const decodeAudio = (b64: string, mime: string): Blob => {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

const blobToBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
};
