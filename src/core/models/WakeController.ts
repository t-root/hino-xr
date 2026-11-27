import { MAX_TALK_MS } from "../audio/VoiceCapture";
import { WakeListener, type Heard } from "../audio/WakeListener";
import { currentLocale } from "../state/LocaleStore";
import { createLogger } from "../observability/diagnostics";
import { useRuntimeStore } from "../state/RuntimeStore";
import type { ModelBridge } from "./ModelBridge";
import { ModelClient } from "./ModelClient";

const CALL_MAX_MS = 5000;
const QUESTION_WORDS = 2;
const LEVEL_EVERY_MS = 250;
const LEVEL_SCALE = 500;
const TAIL_MS = 500;
const STOP_MAX_MS = 3000;

type Mode =
  | "off"
  | "system"
  | "sleep"
  | "awake"
  | "busy";

export class WakeController {
  private readonly client = new ModelClient();
  private readonly listener = new WakeListener((heard) => void this.onHeard(heard));
  private readonly logger = createLogger("wake");
  private mode: Mode = "off";
  private checking = false;
  private onSystemCall: (() => void) | null = null;
  private windowTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private disposed = false;

  private lastLevelMs = 0;

  constructor(private readonly bridge: ModelBridge) {
    this.listener.onLevel = (level) => {
      const now = performance.now();
      if (now - this.lastLevelMs < LEVEL_EVERY_MS) return;
      this.lastLevelMs = now;
      useRuntimeStore.getState().setDiagnostics({ micLevel: Math.min(99, Math.round(level * LEVEL_SCALE)) });
    };
  }

  async listenForSystemCall(onCall: () => void): Promise<void> {
    await this.listener.open();
    this.onSystemCall = onCall;
    this.enter("system");
  }

  simulateSystemCall(): boolean {
    if (this.mode !== "system") return false;
    this.logger.info("system call simulated");
    this.enter("off");
    const call = this.onSystemCall;
    this.onSystemCall = null;
    call?.();
    return true;
  }

  async listenForAssistant(): Promise<void> {
    if (!this.assistantOn()) {
      this.enter("off");
      return;
    }
    try {
      await this.listener.open();
    } catch (error) {
      this.logger.warn("microphone unavailable", { message: error instanceof Error ? error.message : String(error) });
      return;
    }
    this.watchAssistant();
    this.enter("sleep");
    if (this.bridge.talking()) this.listener.setPaused(true);
  }

  syncSettings(): void {
    if (this.mode === "system" || this.mode === "busy") return;
    if (!this.assistantOn()) {
      this.enter("off");
      this.bridge.markListening(false);
    } else if (this.mode === "off" && this.listener.isOpen) {
      this.enter("sleep");
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.listener.close();
    this.mode = "off";
  }

  private assistantOn(): boolean {
    return useRuntimeStore.getState().settings.assistant.enabled;
  }

  private listenMs(): number {
    return useRuntimeStore.getState().settings.assistant.listenSeconds * 1000;
  }

  private clearTimers(): void {
    if (this.windowTimer !== null) clearTimeout(this.windowTimer);
    if (this.resumeTimer !== null) clearTimeout(this.resumeTimer);
    this.windowTimer = null;
    this.resumeTimer = null;
  }

  private enter(mode: Mode): void {
    if (mode !== this.mode) this.logger.info(`mode ${this.mode} -> ${mode}`);
    useRuntimeStore.getState().setDiagnostics({ micMode: mode });
    this.mode = mode;
    this.clearTimers();
    this.listener.setMaxMs(mode === "awake" ? MAX_TALK_MS : CALL_MAX_MS);
    this.listener.setPaused(mode === "off" || mode === "busy");
    if (mode === "awake") this.openWindow();
  }

  private openWindow(): void {
    this.windowTimer = setTimeout(() => {
      if (this.mode !== "awake") return;
      if (this.listener.speaking) {
        this.openWindow();
        return;
      }
      this.bridge.markListening(false);
      this.enter("sleep");
    }, this.listenMs());
  }

  private watchAssistant(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = useRuntimeStore.subscribe((state, previous) => {
      const was = previous.assistant.state;
      const now = state.assistant.state;
      if (now === was || this.mode === "off" || this.mode === "system") return;
      const talking = now === "speaking" || now === "generating";
      if (talking) {
        if (!this.bargeIn()) this.listener.setPaused(true);
        return;
      }
      if (this.mode === "sleep" || this.mode === "awake") {
        this.resumeLater();
      }
    });
  }

  private resumeLater(): void {
    if (this.resumeTimer !== null) clearTimeout(this.resumeTimer);
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      if (this.disposed || this.bridge.talking()) return;
      if (this.mode === "sleep" || this.mode === "awake") this.listener.setPaused(false);
    }, TAIL_MS);
  }

  private async onHeard(heard: Heard): Promise<void> {
    this.logger.info(`mic picked up a line`, { ms: Math.round(heard.durationMs), mode: this.mode, skipped: this.checking });
    if (this.checking || this.disposed) return;
    if (this.bargeIn() && this.bridge.talking() && (this.mode === "sleep" || this.mode === "awake")) {
      if (heard.durationMs <= STOP_MAX_MS) await this.checkStop(heard);
      return;
    }
    if (this.mode === "system") {
      await this.checkSystemCall(heard);
    } else if (this.mode === "sleep") {
      if (this.bridge.talking()) return;
      await this.checkAssistantCall(heard);
    } else if (this.mode === "awake") {
      await this.takeQuestion(heard);
    }
  }

  private bargeIn(): boolean {
    return useRuntimeStore.getState().settings.assistant.bargeIn;
  }

  private async checkStop(heard: Heard): Promise<void> {
    this.checking = true;
    try {
      const verdict = await this.client.listen(heard.blob, "stop", currentLocale());
      this.logger.info("stop check", { heard: verdict.heard, matched: verdict.matched });
      if (verdict.matched) this.bridge.stopSpeaking();
    } catch (error) {
      this.logger.warn("stop check failed", { message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.checking = false;
    }
  }

  private async checkSystemCall(heard: Heard): Promise<void> {
    this.checking = true;
    try {
      const verdict = await this.client.listen(heard.blob, "system", currentLocale());
      this.logger.info("system call check", { heard: verdict.heard, matched: verdict.matched });
      if (this.mode !== "system" || !verdict.matched) return;
      this.enter("off");
      const call = this.onSystemCall;
      this.onSystemCall = null;
      call?.();
    } catch (error) {
      this.logger.warn("system call check failed", { message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.checking = false;
    }
  }

  private async checkAssistantCall(heard: Heard): Promise<void> {
    this.checking = true;
    try {
      const verdict = await this.client.listen(heard.blob, "wake", currentLocale());
      this.logger.info("name check", { heard: verdict.heard, matched: verdict.matched, wordsAfter: verdict.after });
      if (this.mode !== "sleep" || !verdict.matched || this.bridge.talking()) return;
      if (verdict.after >= QUESTION_WORDS) {
        await this.answer(heard);
        return;
      }
      this.enter("awake");
      this.bridge.markListening(true);
      this.listener.setPaused(true);
      await this.bridge.acknowledge();
      if (this.mode === "awake") {
        if (this.windowTimer !== null) clearTimeout(this.windowTimer);
        this.openWindow();
        this.listener.setPaused(false);
        this.logger.info("listening for the question");
      }
    } catch (error) {
      this.logger.warn("call check failed", { message: error instanceof Error ? error.message : String(error) });
    } finally {
      this.checking = false;
    }
  }

  private async takeQuestion(heard: Heard): Promise<void> {
    this.checking = true;
    try {
      await this.answer(heard);
    } finally {
      this.checking = false;
    }
  }

  private async answer(heard: Heard): Promise<void> {
    this.enter("busy");
    this.logger.info("sending the line to be answered", { ms: Math.round(heard.durationMs) });
    this.bridge.markListening(false);
    await this.bridge.answerSpeech(heard.blob);
    if (this.disposed) return;
    if (!this.assistantOn()) {
      this.enter("off");
      return;
    }
    await new Promise<void>((resolve) => {
      this.resumeTimer = setTimeout(resolve, TAIL_MS);
    });
    this.resumeTimer = null;
    if (this.disposed || this.mode !== "busy") return;
    this.enter("awake");
    this.bridge.markListening(true);
  }
}
