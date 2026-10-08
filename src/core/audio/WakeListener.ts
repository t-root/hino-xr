import { encodeWav } from "./wav";

/** Speech shorter than this is a cough or a knock, not a word. */
const MIN_SPEECH_MS = 250;
/** Quiet this long ends a line. */
const END_SILENCE_MS = 700;
/** Blocks kept from before the voice crossed the threshold, so the first sound is not cut. */
const PRE_ROLL_BLOCKS = 3;
/** Loud blocks in a row that count as the start of speech. */
const START_BLOCKS = 2;
/** What Whisper reads. */
const TARGET_RATE = 16_000;
/** The voice has to be at least this loud, and this many times the room's own noise. */
const MIN_LEVEL = 0.02;
const NOISE_MARGIN = 3;

export type Heard = Readonly<{ blob: Blob; durationMs: number }>;

/**
 * An open microphone that cuts what it hears into lines of speech.
 *
 * It decides only where a line starts and stops, by loudness. What was said is
 * the model server's business. While paused it throws every sample away, so
 * the assistant's own voice and the time it is busy are never kept.
 */
export class WakeListener {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private mute: GainNode | null = null;
  private paused = true;
  private maxMs = 5000;
  private floor = 0.01;
  private inSpeech = false;
  private loudRun = 0;
  private quietMs = 0;
  private lengthMs = 0;
  private preRoll: Float32Array[] = [];
  private segment: Float32Array[] = [];

  constructor(private readonly onHeard: (heard: Heard) => void) {}

  /** True while a line is being spoken. */
  get speaking(): boolean {
    return this.inSpeech;
  }

  get isOpen(): boolean {
    return this.stream !== null;
  }

  async open(): Promise<void> {
    if (this.stream) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("no mic");
    const Ctor =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) throw new Error("no mic");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
        video: false,
      });
      this.context = new Ctor();
      await this.context.resume();
      const rate = this.context.sampleRate;
      this.source = this.context.createMediaStreamSource(this.stream);
      this.processor = this.context.createScriptProcessor(4096, 1, 1);
      this.processor.onaudioprocess = (event) =>
        this.hear(new Float32Array(event.inputBuffer.getChannelData(0)), rate);
      this.mute = this.context.createGain();
      this.mute.gain.value = 0;
      this.source.connect(this.processor);
      this.processor.connect(this.mute);
      this.mute.connect(this.context.destination);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  /** The longest a single line may run before it is handed over as it is. */
  setMaxMs(ms: number): void {
    this.maxMs = ms;
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    this.reset();
  }

  close(): void {
    this.reset();
    this.processor?.disconnect();
    this.source?.disconnect();
    this.mute?.disconnect();
    this.processor = null;
    this.source = null;
    this.mute = null;
    if (this.context && this.context.state !== "closed") void this.context.close();
    this.context = null;
    if (this.stream) for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
    this.paused = true;
  }

  private hear(block: Float32Array, rate: number): void {
    if (this.paused) return;
    const level = rms(block);
    const blockMs = (block.length / rate) * 1000;
    if (!this.inSpeech) {
      // The room's own noise, followed slowly and only while nobody is speaking.
      this.floor = Math.min(0.05, Math.max(0.003, this.floor * 0.95 + level * 0.05));
    }
    const loud = level > Math.max(MIN_LEVEL, this.floor * NOISE_MARGIN);
    if (!this.inSpeech) {
      this.preRoll.push(block);
      if (this.preRoll.length > PRE_ROLL_BLOCKS) this.preRoll.shift();
      this.loudRun = loud ? this.loudRun + 1 : 0;
      if (this.loudRun < START_BLOCKS) return;
      this.inSpeech = true;
      this.segment = [...this.preRoll];
      this.lengthMs = this.segment.length * blockMs;
      this.quietMs = 0;
      return;
    }
    this.segment.push(block);
    this.lengthMs += blockMs;
    this.quietMs = loud ? 0 : this.quietMs + blockMs;
    if (this.quietMs >= END_SILENCE_MS || this.lengthMs >= this.maxMs) this.finish(rate);
  }

  private finish(rate: number): void {
    const spoken = this.lengthMs - this.quietMs;
    const samples = downsample(concat(this.segment), rate, TARGET_RATE);
    this.reset();
    if (spoken < MIN_SPEECH_MS) return;
    this.onHeard({ blob: encodeWav(samples, TARGET_RATE), durationMs: spoken });
  }

  private reset(): void {
    this.inSpeech = false;
    this.loudRun = 0;
    this.quietMs = 0;
    this.lengthMs = 0;
    this.preRoll = [];
    this.segment = [];
  }
}

const rms = (block: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < block.length; i += 1) {
    const sample = block[i] ?? 0;
    sum += sample * sample;
  }
  return Math.sqrt(sum / Math.max(1, block.length));
};

const concat = (chunks: readonly Float32Array[]): Float32Array => {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

/** Linear resampling; speech for a recogniser does not need better. */
const downsample = (samples: Float32Array, from: number, to: number): Float32Array => {
  if (from <= to) return samples;
  const count = Math.max(1, Math.floor((samples.length * to) / from));
  const out = new Float32Array(count);
  const step = from / to;
  for (let i = 0; i < count; i += 1) {
    const at = i * step;
    const low = Math.floor(at);
    const high = Math.min(samples.length - 1, low + 1);
    const mix = at - low;
    out[i] = (samples[low] ?? 0) * (1 - mix) + (samples[high] ?? 0) * mix;
  }
  return out;
};
