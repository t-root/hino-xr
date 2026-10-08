import type { AssistantSnapshot, ChatMessage, ModelInfo } from "@/shared/contracts/model";
import { EMPTY_ASSISTANT } from "@/shared/contracts/model";
import { SpeechPlayer } from "../audio/SpeechPlayer";
import { encodeWav } from "../audio/wav";
import { MIN_TALK_MS, MAX_TALK_MS, VoiceCapture } from "../audio/VoiceCapture";
import { currentLocale } from "../state/LocaleStore";
import { createLogger } from "../observability/diagnostics";
import { useRuntimeStore } from "../state/RuntimeStore";
import { DEFAULT_SETTINGS, type Settings } from "../state/settings";
import { ModelClient } from "./ModelClient";

const POLL_MS = 8000;
const DEFAULT_ID = DEFAULT_SETTINGS.assistant.modelId;
const HISTORY = 24;

/** Two quick rising notes, soft enough not to startle in a headset. */
const listeningCue = (): Blob => {
  const rate = 22_050;
  const note = (hz: number, seconds: number): Float32Array => {
    const count = Math.floor(rate * seconds);
    const out = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      const fade = Math.min(1, i / 200, (count - i) / 400);
      out[i] = 0.18 * fade * Math.sin((2 * Math.PI * hz * i) / rate);
    }
    return out;
  };
  const low = note(660, 0.08);
  const high = note(990, 0.1);
  const joined = new Float32Array(low.length + high.length);
  joined.set(low, 0);
  joined.set(high, low.length);
  return encodeWav(joined, rate);
};
/** Skip poll during a live turn. Load and wake already talk to the server. */
const HOLD_POLL = new Set(["generating", "listening", "speaking"]);

/**
 * Keeps the UI store in step with the model server. Poll, load, ask, talk,
 * wake: that is the whole of what the headset is allowed to do with a language
 * model.
 */
export class ModelBridge {
  private readonly client = new ModelClient();
  private readonly capture = new VoiceCapture();
  private readonly player = new SpeechPlayer();
  private readonly logger = createLogger("models");
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private askAbort: AbortController | null = null;
  private limitTimer: ReturnType<typeof setTimeout> | null = null;
  private phase: "idle" | "listening" | "sending" = "idle";
  private opening: Promise<void> | null = null;
  private enabled = DEFAULT_SETTINGS.assistant.enabled;
  private modelId = DEFAULT_ID;
  private inSession = false;
  private waking = false;
  private refreshBusy = false;

  constructor() {
    const assistant = useRuntimeStore.getState().settings.assistant;
    this.enabled = assistant.enabled;
    this.modelId = assistant.modelId;
  }

  start(): void {
    if (this.pollTimer !== null) return;
    void this.refresh();
    this.pollTimer = setInterval(() => {
      if (this.waking) return;
      const state = useRuntimeStore.getState().assistant.state;
      if (HOLD_POLL.has(state) || state === "loading") return;
      void this.refresh();
    }, POLL_MS);
  }

  dispose(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.clearLimit();
    this.askAbort?.abort();
    this.askAbort = null;
    this.phase = "idle";
    this.inSession = false;
    this.waking = false;
    this.capture.abort();
    this.player.dispose();
    useRuntimeStore.getState().setAssistant(EMPTY_ASSISTANT);
  }

  /** Call from the Start tap before any await, so later speech is allowed. */
  prepareAudio(): void {
    this.player.unlock();
  }

  /** After the camera is up: poll the catalog, then greet if the assistant is on. */
  onSessionStart(): void {
    this.inSession = true;
    this.start();
    if (this.enabled) void this.wake();
  }

  syncSettings(settings: Settings): void {
    const wasEnabled = this.enabled;
    const wasModel = this.modelId;
    this.enabled = settings.assistant.enabled;
    this.modelId = settings.assistant.modelId;
    if (!this.enabled) {
      this.silence();
      return;
    }
    if (this.inSession && !wasEnabled) {
      void this.wake();
      return;
    }
    if (this.inSession && this.modelId !== wasModel) {
      void this.load(this.modelId);
    }
  }

  async load(id?: string): Promise<void> {
    const modelId = id ?? this.selectedId();
    this.modelId = modelId;
    try {
      const listed = await this.client.list();
      const existing = listed.find((item) => item.id === modelId);
      if (existing?.state === "ready") {
        this.publish(existing, listed);
        return;
      }
      useRuntimeStore.getState().patchAssistant({ id: modelId, state: "loading", error: null, voiceIssue: null });
      const info = await this.client.load(modelId);
      if (info === "offline") {
        useRuntimeStore.getState().patchAssistant({ state: "offline", error: null, voice: "idle" });
        this.logger.warn("model server did not answer a load");
        return;
      }
      const after = await this.client.list();
      this.publish(info, after.length > 0 ? after : [info]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useRuntimeStore.getState().patchAssistant({ state: "failed", error: message, greeted: true });
      this.logger.error("load failed", { message });
    }
  }

  async wake(): Promise<void> {
    if (!this.enabled || this.waking) return;
    this.waking = true;
    const id = this.selectedId();
    this.modelId = id;
    this.askAbort?.abort();
    this.player.stop();
    const abort = new AbortController();
    this.askAbort = abort;
    useRuntimeStore.getState().patchAssistant({
      id,
      state: "loading",
      reply: "",
      error: null,
      voiceIssue: null,
    });
    this.beginAssistantReply();
    try {
      const result = await this.client.wake(
        id,
        currentLocale(),
        (token) => this.appendToken(token),
        abort.signal,
        (state) => {
          if (state === "ready") {
            useRuntimeStore.getState().patchAssistant({ state: "generating" });
          }
          if (state === "failed") {
            const listed = useRuntimeStore.getState().assistant;
            useRuntimeStore.getState().patchAssistant({
              state: "failed",
              error: listed.error,
              greeted: true,
            });
          }
        },
        this.voice(),
        this.audioSink(abort),
        useRuntimeStore.getState().settings.assistant.greeting[currentLocale()],
      );
      if (abort.signal.aborted) return;
      this.settleReply(result.reply, { state: result.audio.length > 0 ? "speaking" : "ready", greeted: true });
      await this.player.idle();
      if (abort.signal.aborted) return;
      useRuntimeStore.getState().patchAssistant({ state: "ready" });
    } catch (error) {
      if (abort.signal.aborted) return;
      this.fail(error);
    } finally {
      this.waking = false;
    }
  }

  async ask(content: string): Promise<void> {
    if (!this.enabled) return;
    const trimmed = content.trim();
    if (!trimmed) return;
    const id = this.selectedId();
    this.askAbort?.abort();
    this.player.stop();
    const abort = new AbortController();
    this.askAbort = abort;
    this.startUserTurn(trimmed);
    const payload = this.historyForRequest();
    try {
      const result = await this.client.complete(
        id,
        payload,
        (token) => this.appendToken(token),
        abort.signal,
        true,
        currentLocale(),
        this.voice(),
        this.audioSink(abort),
      );
      if (abort.signal.aborted) return;
      this.settleReply(result.reply, { state: result.audio.length > 0 ? "speaking" : "ready", greeted: true });
      await this.player.idle();
      if (abort.signal.aborted) return;
      useRuntimeStore.getState().patchAssistant({ state: "ready" });
    } catch (error) {
      if (abort.signal.aborted) return;
      this.fail(error);
    }
  }

  toggleTalk(): void {
    if (this.phase === "listening") {
      void this.endTalk();
      return;
    }
    this.beginTalk();
  }

  beginTalk(): void {
    if (!this.enabled) return;
    if (this.phase !== "idle") return;
    this.phase = "listening";
    this.player.stop();
    this.player.unlock();
    this.askAbort?.abort();
    useRuntimeStore.getState().patchAssistant({
      state: "listening",
      error: null,
      voiceIssue: null,
      heard: "",
      reply: "",
    });
    this.clearLimit();
    this.limitTimer = setTimeout(() => {
      void this.endTalk();
    }, MAX_TALK_MS);
    this.opening = this.capture.start().catch((error: unknown) => {
      this.phase = "idle";
      this.clearLimit();
      useRuntimeStore.getState().patchAssistant({
        state: "ready",
        voiceIssue: "noMic",
      });
      this.logger.error("mic failed", { message: error instanceof Error ? error.message : String(error) });
    });
  }

  async endTalk(): Promise<void> {
    if (this.phase !== "listening") return;
    this.phase = "sending";
    this.clearLimit();
    try {
      if (this.opening) await this.opening;
      this.opening = null;
      if (this.phase !== "sending") return;
      const recording = this.capture.stop();
      if (recording.durationMs < MIN_TALK_MS) {
        this.phase = "idle";
        useRuntimeStore.getState().patchAssistant({ state: "ready", voiceIssue: "tooShort" });
        return;
      }
      await this.sendTalk(recording.blob);
    } catch (error) {
      this.phase = "idle";
      this.fail(error);
    }
  }

  cancelTalk(): void {
    if (this.phase === "idle") return;
    this.phase = "idle";
    this.clearLimit();
    this.askAbort?.abort();
    this.capture.abort();
    this.player.stop();
    const current = useRuntimeStore.getState().assistant;
    useRuntimeStore.getState().patchAssistant({
      state: current.id ? "ready" : "offline",
      voiceIssue: null,
    });
  }

  private silence(): void {
    this.askAbort?.abort();
    this.cancelTalk();
    this.player.stop();
  }

  /**
   * Hands each sentence to the speaker the moment the server has it, while the
   * model is still writing the next one. Without this the wearer would hear
   * nothing until the whole reply existed.
   */
  private audioSink(abort: AbortController): (audio: Blob) => void {
    return (audio) => {
      if (abort.signal.aborted) return;
      this.player.enqueue(audio);
      if (useRuntimeStore.getState().assistant.state !== "speaking") {
        useRuntimeStore.getState().patchAssistant({ state: "speaking" });
      }
    };
  }

  private voice() {
    return useRuntimeStore.getState().settings.assistant.voice;
  }

  /** Speaks a fixed line in the current voice settings so the wearer can judge them. */
  async previewVoice(text: string): Promise<void> {
    if (!this.enabled) return;
    this.askAbort?.abort();
    const abort = new AbortController();
    this.askAbort = abort;
    this.player.stop();
    this.player.unlock();
    try {
      const audio = await this.client.preview(text, currentLocale(), this.voice(), abort.signal);
      if (abort.signal.aborted) return;
      await this.player.play(audio);
    } catch (error) {
      if (abort.signal.aborted) return;
      this.logger.warn("voice preview failed", { message: error instanceof Error ? error.message : String(error) });
    }
  }

  private selectedId(): string {
    return useRuntimeStore.getState().settings.assistant.modelId || this.modelId || DEFAULT_ID;
  }

  /**
   * Answers a line the wearer spoke without pressing anything: the microphone
   * heard the assistant's name, and the line may begin with it.
   */
  async answerSpeech(wav: Blob): Promise<void> {
    if (!this.enabled || this.phase !== "idle") return;
    this.phase = "sending";
    this.player.stop();
    await this.sendTalk(wav, true);
  }

  /** True while a turn is under way, however it began. */
  busy(): boolean {
    const state = useRuntimeStore.getState().assistant.state;
    return this.phase !== "idle" || this.waking || state === "generating" || state === "speaking" || state === "loading";
  }

  /** The assistant is waiting for the wearer to speak, or has stopped waiting. */
  markListening(on: boolean): void {
    const current = useRuntimeStore.getState().assistant;
    if (on) {
      useRuntimeStore.getState().patchAssistant({ state: "listening", error: null, voiceIssue: null });
    } else if (current.state === "listening" && this.phase === "idle") {
      useRuntimeStore.getState().patchAssistant({ state: current.id ? "ready" : "offline" });
    }
  }

  /** A short rising tone: the assistant heard its name and is listening. */
  cue(): void {
    this.player.enqueue(listeningCue());
  }

  /** Resolves when nothing is being played. */
  quiet(): Promise<void> {
    return this.player.idle();
  }

  private async sendTalk(wav: Blob, stripWake = false): Promise<void> {
    const id = this.selectedId();
    const locale = currentLocale();
    this.askAbort?.abort();
    const abort = new AbortController();
    this.askAbort = abort;
    useRuntimeStore.getState().patchAssistant({
      state: "generating",
      reply: "",
      heard: "",
      error: null,
      voiceIssue: null,
    });
    try {
      const result = await this.client.talk(
        id,
        wav,
        locale,
        (token) => this.appendToken(token),
        (heard) => {
          if (heard.trim()) this.startUserTurn(heard);
        },
        abort.signal,
        this.historyForRequest(),
        this.voice(),
        this.audioSink(abort),
        stripWake,
      );
      if (abort.signal.aborted) {
        this.phase = "idle";
        return;
      }
      this.settleReply(result.reply, {
        state: result.audio.length > 0 ? "speaking" : "ready",
        heard: result.transcript,
      });
      await this.player.idle();
      if (abort.signal.aborted) {
        this.phase = "idle";
        return;
      }
      this.phase = "idle";
      useRuntimeStore.getState().patchAssistant({ state: "ready" });
    } catch (error) {
      this.phase = "idle";
      if (abort.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      if (message === "no speech") {
        useRuntimeStore.getState().patchAssistant({ state: "ready", voiceIssue: "noSpeech" });
        return;
      }
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const offline = message === "offline";
    useRuntimeStore.getState().patchAssistant({
      state: offline ? "offline" : "failed",
      error: offline ? null : message,
      greeted: true,
    });
    this.logger.error("complete failed", { message });
  }

  private clearLimit(): void {
    if (this.limitTimer !== null) {
      clearTimeout(this.limitTimer);
      this.limitTimer = null;
    }
  }

  private async refresh(): Promise<void> {
    if (this.refreshBusy) return;
    this.refreshBusy = true;
    try {
      await this.refreshOnce();
    } finally {
      this.refreshBusy = false;
    }
  }

  private async refreshOnce(): Promise<void> {
    const listed = await this.client.list();
    const current = useRuntimeStore.getState().assistant;
    if (listed.length === 0) {
      if (current.state !== "offline") {
        useRuntimeStore.getState().patchAssistant({
          ...EMPTY_ASSISTANT,
          reply: current.reply,
          heard: current.heard,
          messages: current.messages,
          catalog: [],
        });
      }
      return;
    }
    const wanted = this.selectedId();
    const info = listed.find((item) => item.id === wanted) ?? listed.find((item) => item.id === current.id) ?? listed[0];
    if (!info) return;
    if (HOLD_POLL.has(current.state)) return;
    this.publish(info, listed, current.reply, current.heard);
  }

  private historyForRequest(): ChatMessage[] {
    return useRuntimeStore
      .getState()
      .assistant.messages.filter((item) => item.role !== "system" && item.content.trim())
      .slice(-12);
  }

  private beginAssistantReply(): void {
    const current = useRuntimeStore.getState().assistant;
    const messages = current.messages.filter((item) => item.content.trim()).slice();
    messages.push({ role: "assistant", content: "" });
    useRuntimeStore.getState().patchAssistant({
      messages: messages.slice(-HISTORY),
      reply: "",
    });
  }

  private startUserTurn(content: string): void {
    const current = useRuntimeStore.getState().assistant;
    const messages = current.messages.filter((item) => item.content.trim()).slice();
    const last = messages[messages.length - 1];
    if (last?.role === "user" && last.content === content) {
      if (messages[messages.length - 1]?.role !== "assistant") messages.push({ role: "assistant", content: "" });
    } else {
      messages.push({ role: "user", content }, { role: "assistant", content: "" });
    }
    useRuntimeStore.getState().patchAssistant({
      state: "generating",
      reply: "",
      heard: content,
      error: null,
      voiceIssue: null,
      messages: messages.slice(-HISTORY),
    });
  }

  private settleReply(reply: string, extra: Partial<AssistantSnapshot> = {}): void {
    const current = useRuntimeStore.getState().assistant;
    const messages = current.messages.slice();
    const last = messages[messages.length - 1];
    if (last?.role === "assistant") {
      messages[messages.length - 1] = { role: "assistant", content: reply };
    } else if (reply.trim()) {
      messages.push({ role: "assistant", content: reply });
    }
    useRuntimeStore.getState().patchAssistant({
      reply,
      messages: messages.filter((item) => item.content.trim()).slice(-HISTORY),
      ...extra,
    });
  }

  private appendToken(token: string): void {
    const current = useRuntimeStore.getState().assistant;
    const messages = current.messages.slice();
    const last = messages[messages.length - 1];
    if (last?.role === "assistant") {
      messages[messages.length - 1] = { role: "assistant", content: last.content + token };
    } else {
      messages.push({ role: "assistant", content: token });
    }
    const reply = (last?.role === "assistant" ? last.content : "") + token;
    useRuntimeStore.getState().patchAssistant({
      // Sentences may already be playing while the rest is still being written.
      state: current.state === "speaking" ? "speaking" : "generating",
      reply,
      messages: messages.slice(-HISTORY),
    });
  }

  private publish(
    info: ModelInfo,
    catalog: readonly ModelInfo[],
    reply = useRuntimeStore.getState().assistant.reply,
    heard = useRuntimeStore.getState().assistant.heard,
  ): void {
    const live = useRuntimeStore.getState().assistant;
    const snapshot: AssistantSnapshot = {
      state: info.state,
      id: info.id,
      source: info.source,
      device: info.device,
      error: info.error,
      voice: info.voice ?? "idle",
      heard,
      reply,
      messages: live.messages,
      voiceIssue: live.voiceIssue,
      catalog,
      greeted: live.greeted,
    };
    const prev = live;
    if (
      prev.state === snapshot.state &&
      prev.id === snapshot.id &&
      prev.source === snapshot.source &&
      prev.device === snapshot.device &&
      prev.error === snapshot.error &&
      prev.voice === snapshot.voice &&
      prev.heard === snapshot.heard &&
      prev.reply === snapshot.reply &&
      prev.voiceIssue === snapshot.voiceIssue &&
      prev.greeted === snapshot.greeted &&
      prev.messages === snapshot.messages &&
      prev.catalog.length === snapshot.catalog.length &&
      prev.catalog.every(
        (item, index) =>
          item.id === snapshot.catalog[index]?.id &&
          item.state === snapshot.catalog[index]?.state &&
          item.voice === snapshot.catalog[index]?.voice,
      )
    ) {
      return;
    }
    useRuntimeStore.getState().setAssistant(snapshot);
  }
}
