import { MAX_TALK_MS, MIN_TALK_MS, VoiceCapture } from "../audio/VoiceCapture";
import { ModelClient } from "../models/ModelClient";
import { useKeyboardStore } from "../state/KeyboardStore";
import { typeDictation } from "./keyboardInput";

/**
 * The on-screen keyboard's microphone key: press, say it, press again, and the words are typed into the box.
 * It is a faster way to fill a box than a keyboard held in the air, above all for a whole sentence.
 */
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
      // The server is away or heard nothing: nothing is typed, and the key is free again.
    } finally {
      useKeyboardStore.getState().setTranscribing(false);
    }
  }

  /** The keyboard went away mid-recording. */
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
