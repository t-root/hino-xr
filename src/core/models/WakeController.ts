import { MAX_TALK_MS } from "../audio/VoiceCapture";
import { WakeListener, type Heard } from "../audio/WakeListener";
import { currentLocale } from "../state/LocaleStore";
import { createLogger } from "../observability/diagnostics";
import { useRuntimeStore } from "../state/RuntimeStore";
import type { ModelBridge } from "./ModelBridge";
import { ModelClient } from "./ModelClient";

/** A call is a word or two; anything longer than this is conversation. */
const CALL_MAX_MS = 5000;
/** Words after the call that mean the question came with it. */
const QUESTION_WORDS = 2;
/** After the assistant stops speaking, wait for the room to go quiet before listening again. */
const TAIL_MS = 500;

type Mode =
  /** Not listening for anything. */
  | "off"
  /** Waiting for "system call". */
  | "system"
  /** System is up; waiting for the assistant's name. */
  | "sleep"
  /** Called; listening for the question, or for the next one. */
  | "awake"
  /** A line was taken; the answer is on its way. */
  | "busy";

/**
 * Decides what the microphone is for.
 *
 * Before the system runs it waits for "system call" and nothing else. Once the
 * system is up it waits for the assistant's name; the first thing said after
 * that is the question, and for a few seconds after each answer the next one
 * needs no name. Then it goes back to sleep. Hearing is the model server's job:
 * this only sends lines that are loud enough to be speech and acts on the verdict.
 */
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

  constructor(private readonly bridge: ModelBridge) {}

  /** Opens the microphone and waits for "system call". Throws if there is no microphone. */
  async listenForSystemCall(onCall: () => void): Promise<void> {
    await this.listener.open();
    this.onSystemCall = onCall;
    this.enter("system");
  }

  /** The system is up: from now on the assistant answers to its name. */
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
    // The greeting may still be playing as the system comes up: do not hear it as the wearer.
    if (this.bridge.busy()) this.listener.setPaused(true);
  }

  /** Settings changed: follow the assistant being switched on or off. */
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
    this.mode = mode;
    this.clearTimers();
    this.listener.setMaxMs(mode === "awake" ? MAX_TALK_MS : CALL_MAX_MS);
    this.listener.setPaused(mode === "off" || mode === "busy");
    if (mode === "awake") this.openWindow();
  }

  /** The wearer has `listenSeconds` to start speaking; a line in progress is let finish. */
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

  /** The assistant speaking is not the wearer: stop hearing it, and resume once it is quiet. */
  private watchAssistant(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = useRuntimeStore.subscribe((state, previous) => {
      const was = previous.assistant.state;
      const now = state.assistant.state;
      if (now === was || this.mode === "off" || this.mode === "system") return;
      const talking = now === "speaking" || now === "generating" || now === "loading";
      if (talking) {
        this.listener.setPaused(true);
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
      if (this.disposed || this.bridge.busy()) return;
      if (this.mode === "sleep" || this.mode === "awake") this.listener.setPaused(false);
    }, TAIL_MS);
  }

  private async onHeard(heard: Heard): Promise<void> {
    if (this.checking || this.disposed) return;
    if (this.mode === "system") {
      await this.checkSystemCall(heard);
    } else if (this.mode === "sleep") {
      if (this.bridge.busy()) return;
      await this.checkAssistantCall(heard);
    } else if (this.mode === "awake") {
      await this.takeQuestion(heard);
    }
  }

  private async checkSystemCall(heard: Heard): Promise<void> {
    this.checking = true;
    try {
      const verdict = await this.client.listen(heard.blob, "system", currentLocale());
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
      if (this.mode !== "sleep" || !verdict.matched || this.bridge.busy()) return;
      if (verdict.after >= QUESTION_WORDS) {
        // "hino, what time is it": the question is already in this line.
        await this.answer(heard);
        return;
      }
      this.enter("awake");
      this.bridge.markListening(true);
      this.bridge.cue();
      this.listener.setPaused(true);
      await this.bridge.quiet();
      if (this.mode === "awake") this.listener.setPaused(false);
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

  /** Sends the line to be understood and answered, then keeps listening for a follow-up. */
  private async answer(heard: Heard): Promise<void> {
    this.enter("busy");
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
