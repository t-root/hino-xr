import { MAX_TALK_MS, MIN_TALK_MS, VoiceCapture } from "../audio/VoiceCapture";
import { ModelClient } from "../models/ModelClient";
import { useKeyboardStore } from "../state/KeyboardStore";
import { typeDictation } from "./keyboardInput";

export class Dictation {
  private readonly capture = new VoiceCapture();
  private readonly client = new ModelClient();
  private limit: number | null = null;

  async toggle(): Promise<void> {
    const keyboard = useKeyboardStore.getState();
    if (keyboard.transcribing) return;
    if (!keyboard.listening) {
      try {
        await this.capture.start();
      } catch {
        return;
      }
      keyboard.setListening(true);
      this.limit = window.setTimeout(() => void this.toggle(), MAX_TALK_MS);
      return;
    }
    this.clearLimit();
    keyboard.setListening(false);
    const recording = this.capture.stop();
    if (recording.durationMs < MIN_TALK_MS) return;
    keyboard.setTranscribing(true);
    try {
      typeDictation(await this.client.dictate(recording.blob, keyboard.lang));
    } catch {
    } finally {
      useKeyboardStore.getState().setTranscribing(false);
    }
  }

  cancel(): void {
    this.clearLimit();
    this.capture.abort();
    useKeyboardStore.getState().setListening(false);
  }

  private clearLimit(): void {
    if (this.limit !== null) window.clearTimeout(this.limit);
    this.limit = null;
  }
}
