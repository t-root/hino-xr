import { encodeWav } from "./wav";

/**
 * One loudspeaker, kept out of the duplicated stereo DOM (rules.md).
 *
 * The headset UI never mounts an <audio> tag. This element lives in Core and
 * is not inserted into either eye.
 *
 * A reply arrives as sentences while the model is still writing, so playback is
 * a queue: each piece starts as soon as the one before it ends.
 */
export class SpeechPlayer {
  private readonly el: HTMLAudioElement;
  private objectUrl: string | null = null;
  private readonly queue: Blob[] = [];
  private draining = false;
  private finishCurrent: (() => void) | null = null;
  private waiting: Array<() => void> = [];

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

  /** Plays after whatever is already queued. */
  enqueue(blob: Blob): void {
    this.queue.push(blob);
    if (!this.draining) void this.drain();
  }

  /** Replaces whatever is playing and resolves when this one has ended. */
  async play(blob: Blob): Promise<void> {
    this.stop();
    this.enqueue(blob);
    await this.idle();
  }

  /** Resolves when nothing is playing and nothing is waiting. */
  idle(): Promise<void> {
    if (!this.draining && this.queue.length === 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.waiting.push(resolve);
    });
  }

  stop(): void {
    this.queue.length = 0;
    const finish = this.finishCurrent;
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
    finish?.();
  }

  dispose(): void {
    this.stop();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      for (;;) {
        const next = this.queue.shift();
        if (!next) break;
        await this.playOne(next);
      }
    } finally {
      this.draining = false;
      const waiting = this.waiting;
      this.waiting = [];
      for (const resolve of waiting) resolve();
    }
  }

  private playOne(blob: Blob): Promise<void> {
    const url = URL.createObjectURL(blob);
    this.objectUrl = url;
    this.el.src = url;
    return new Promise<void>((resolve) => {
      const done = () => {
        this.el.removeEventListener("ended", done);
        this.el.removeEventListener("error", done);
        this.finishCurrent = null;
        this.forget(url);
        resolve();
      };
      this.finishCurrent = done;
      this.el.addEventListener("ended", done);
      this.el.addEventListener("error", done);
      this.el.play().catch(done);
    });
  }

  private forget(url: string): void {
    if (this.objectUrl === url) {
      URL.revokeObjectURL(url);
      this.objectUrl = null;
    }
  }
}
