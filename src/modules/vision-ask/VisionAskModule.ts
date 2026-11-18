import { withAccessKey } from "@/core/auth/accessKey";
import type { CommandReply, ModuleContext, VisionModule } from "@/core/modules/module-contract";
import { ENV } from "@/env";
import type { DetectionBatch, FramePacket } from "@/shared/contracts/vision";
import { visionAskManifest } from "./manifest";
import text from "./text.json";

/** A still older than this is not what the wearer is looking at now (the plugin was only just switched on, or the camera stalled). */
const FRESH_MS = 5000;
/** A picture model on a CPU can take a long while; a lost connection should not wait as long. */
const ANSWER_WAIT_MS = 180_000;
const JPEG_QUALITY = 0.85;

type Look = "ask" | "read" | "translate";

const isLook = (value: unknown): value is Look => value === "ask" || value === "read" || value === "translate";

const toBase64 = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
};

/**
 * Lets the wearer ask about what the camera sees: "what is this", "read this", "translate this".
 *
 * It draws nothing. Each second it copies the frame it is given into one canvas (the frame itself is closed by
 * the manager), and when a question arrives it sends that still to the model server, which answers with a model
 * that reads pictures, on this computer or through the API (`VR_VISION_SOURCE`).
 */
class VisionAskModule implements VisionModule {
  readonly manifest = visionAskManifest;

  private context: ModuleContext | null = null;
  /** Off screen on purpose: nothing here is drawn into an eye, so there is no element to keep in step in both. */
  private canvas: OffscreenCanvas | null = null;
  private stillAt = 0;
  private enabled = false;

  async initialize(context: ModuleContext): Promise<void> {
    this.context = context;
  }

  async process(frame: FramePacket): Promise<DetectionBatch> {
    if (this.enabled) this.keep(frame);
    return { moduleId: this.manifest.id, sourceFrameId: frame.id, producedAtMs: performance.now(), detections: [] };
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;
    if (!enabled) this.forget();
  }

  async command(name: string, payload: Readonly<Record<string, unknown>>): Promise<CommandReply | null> {
    if (name !== "sight" || !isLook(payload.what)) return null;
    const locale = this.context?.locale() ?? "vi";
    const still = await this.still();
    if (!still) return text.noPicture[locale];
    const question = typeof payload.question === "string" ? payload.question : "";
    try {
      return await this.ask(still, payload.what, question, locale);
    } catch (error) {
      this.context?.logger.warn(`could not look: ${error instanceof Error ? error.message : String(error)}`);
      return text.failed[locale];
    }
  }

  async dispose(): Promise<void> {
    this.forget();
  }

  /** Copies the frame to the one canvas; the picture is gone the moment the plugin is switched off. */
  private keep(frame: FramePacket): void {
    // A browser without OffscreenCanvas keeps no still, and the wearer is told there is no picture.
    if (typeof OffscreenCanvas === "undefined") return;
    if (!this.canvas || this.canvas.width !== frame.width || this.canvas.height !== frame.height) {
      this.canvas = new OffscreenCanvas(frame.width, frame.height);
    }
    const drawing = this.canvas.getContext("2d");
    if (!drawing) return;
    drawing.drawImage(frame.image, 0, 0, frame.width, frame.height);
    this.stillAt = performance.now();
  }

  private forget(): void {
    this.canvas = null;
    this.stillAt = 0;
  }

  private async still(): Promise<Blob | null> {
    if (!this.canvas || performance.now() - this.stillAt > FRESH_MS) return null;
    return this.canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  }

  private async ask(still: Blob, what: Look, question: string, locale: string): Promise<CommandReply> {
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), ANSWER_WAIT_MS);
    try {
      const response = await fetch(
        `${ENV.BASE_URL}api/vision/ask`,
        withAccessKey({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: await toBase64(still), what, question, locale }),
          signal: abort.signal,
        }),
      );
      if (!response.ok) throw new Error(`the server answered ${response.status}`);
      const body = (await response.json()) as { say?: unknown; show?: unknown };
      const say = typeof body.say === "string" ? body.say : "";
      if (!say) throw new Error("the server sent no answer");
      return { say, show: typeof body.show === "string" && body.show ? body.show : say };
    } finally {
      window.clearTimeout(timer);
    }
  }
}

export const createVisionAskModule = (): VisionModule => new VisionAskModule();
