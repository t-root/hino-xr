import { encodeWav } from "./wav";

/**
 * One loudspeaker, kept out of the duplicated stereo DOM (rules.md).
 *
 * The headset UI never mounts an <audio> tag. This element lives in Core and
 * is not inserted into either eye.
 */
export class SpeechPlayer {
  private readonly el: HTMLAudioElement;
  private objectUrl: string | null = null;

  constructor() {
    this.el = new Audio();
    this.el.preload = "auto";
  }

  /** Call from the hold gesture so later playback is allowed on iOS. */
  unlock(): void {
    const url = URL.createObjectURL(encodeWav(new Float32Array(1), 16_000));
    this.el.src = url;
    void this.el
      .play()
      .then(() => {
        this.el.pause();
        URL.revokeObjectURL(url);
      })
      .catch(() => {
        URL.revokeObjectURL(url);
      });
  }

  async play(blob: Blob): Promise<void> {
    this.stop();
    const url = URL.createObjectURL(blob);
    this.objectUrl = url;
    this.el.src = url;
    try {
      await this.el.play();
    } catch {
      this.forget(url);
      return;
    }
    await new Promise<void>((resolve) => {
      const done = () => {
        this.el.removeEventListener("ended", done);
        this.el.removeEventListener("error", done);
        resolve();
      };
      this.el.addEventListener("ended", done);
      this.el.addEventListener("error", done);
    });
    this.forget(url);
  }

  stop(): void {
    this.el.pause();
    this.el.removeAttribute("src");
    try {
      this.el.load();
    } catch {
      // jsdom and some WebViews throw if load() runs without a source.
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  dispose(): void {
    this.stop();
  }

  private forget(url: string): void {
    if (this.objectUrl === url) {
      URL.revokeObjectURL(url);
      this.objectUrl = null;
    }
  }
}
