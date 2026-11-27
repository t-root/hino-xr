import { encodeWav } from "./wav";

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

  enqueue(blob: Blob): void {
    this.queue.push(blob);
    if (!this.draining) void this.drain();
  }

  async play(blob: Blob): Promise<void> {
    this.stop();
    this.enqueue(blob);
    await this.idle();
  }

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
      this.el.play().catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) console.warn("speech playback blocked", error);
        done();
      });
    });
  }

  private forget(url: string): void {
    if (this.objectUrl === url) {
      URL.revokeObjectURL(url);
      this.objectUrl = null;
    }
  }
}
