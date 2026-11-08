import { ASSETS } from "@/core/config";
import { createDetectorModule } from "@/core/modules/DetectorModule";
import type { ModuleContext, VisionModule } from "@/core/modules/module-contract";
import { spawnInferenceWorker } from "@/core/workers/spawn";
import { fill } from "@/i18n/text";
import type { Detection, DetectionBatch, FramePacket } from "@/shared/contracts/vision";
import { READER_SCRIPT_URL, READER_WASM_URL } from "./assets";
import { codeReaderManifest } from "./manifest";
import text from "./text.json";

const MAX_CODES = 4;

/** A code leaves the frame and comes back; one seen this recently, ms, still counts as in view. */
const IN_VIEW_MS = 3000;

/** What is written over a box; a long address is cut, the whole of it is read out. */
const LABEL_CHARS = 28;

/** What is read aloud; a code can hold pages. */
const SPEECH_CHARS = 200;

const cut = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

const words = text as unknown as Readonly<Record<string, Readonly<Record<"vi" | "en", string>> | undefined>>;

type Seen = Readonly<{ text: string; format: string; at: number }>;

/**
 * Reads QR codes and barcodes. The decoded text is written over the box; asked "read the code", the
 * assistant says what the one in view holds.
 */
class CodeReaderModule implements VisionModule {
  readonly manifest = codeReaderManifest;

  private readonly detector = createDetectorModule({
    manifest: codeReaderManifest,
    createWorker: () => spawnInferenceWorker("modules/code-reader/code.worker.ts"),
    init: {
      wasmBase: ASSETS.wasmBase,
      modelUrl: READER_WASM_URL,
      scoreThreshold: 0,
      options: { maxResults: MAX_CODES, scriptUrl: READER_SCRIPT_URL },
    },
    label: (_locale, detection) => cut(String(detection.attributes?.text ?? ""), LABEL_CHARS),
    // A code held still is steady; one held through a few missed frames flickers less.
    maxMissedFrames: 6,
  });

  private context: ModuleContext | null = null;
  private seen: Seen[] = [];

  async initialize(context: ModuleContext): Promise<void> {
    this.context = context;
    await this.detector.initialize(context);
  }

  async process(frame: FramePacket, signal: AbortSignal): Promise<DetectionBatch> {
    const batch = await this.detector.process(frame, signal);
    const now = performance.now();
    const fresh = batch.detections.map(
      (detection: Detection): Seen => ({
        text: String(detection.attributes?.text ?? ""),
        format: String(detection.attributes?.format ?? ""),
        at: now,
      }),
    );
    const kept = this.seen.filter((old) => now - old.at < IN_VIEW_MS && !fresh.some((item) => item.text === old.text));
    this.seen = [...fresh, ...kept];
    return batch;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    if (!enabled) this.seen = [];
    await this.detector.setEnabled(enabled);
  }

  async command(name: string, payload: Readonly<Record<string, unknown>>): Promise<string | null> {
    if (name !== "sight" || payload.what !== "code") return null;
    const locale = this.context?.locale() ?? "vi";
    const now = performance.now();
    const inView = this.seen.filter((item) => now - item.at < IN_VIEW_MS);
    const first = inView[0];
    if (!first) return text.none[locale];
    const format = words[`format.${first.format}`]?.[locale] ?? first.format;
    const body = cut(first.text, SPEECH_CHARS);
    return inView.length === 1
      ? fill(text.one[locale], { format, text: body })
      : fill(text.many[locale], { count: inView.length, format, text: body });
  }

  async dispose(): Promise<void> {
    this.seen = [];
    await this.detector.dispose();
  }
}

export const createCodeReaderModule = (): VisionModule => new CodeReaderModule();
