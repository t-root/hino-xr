import { encodeWav } from "./wav";

const MIN_SPEECH_MS = 250;
const END_SILENCE_MS = 1000;
const PRE_ROLL_BLOCKS = 5;
const START_BLOCKS = 2;
const TARGET_RATE = 16_000;
const MIN_LEVEL = 0.02;
const NOISE_MARGIN = 3;

export type Heard = Readonly<{ blob: Blob; durationMs: number }>;

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

  onLevel: ((level: number) => void) | null = null;

  constructor(private readonly onHeard: (heard: Heard) => void) {}

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
    const level = rms(block);
    this.onLevel?.(level);
    if (this.paused) return;
    const blockMs = (block.length / rate) * 1000;
    if (!this.inSpeech) {
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
    if (spoken < MIN_SPEECH_MS || !hasVoice(samples)) return;
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

const VOICE_FRAME = 512;
const VOICE_HOP = 256;
const MIN_VOICED_FRAMES = 5;
const PITCH_LOW = Math.floor(TARGET_RATE / 400);
const PITCH_HIGH = Math.floor(TARGET_RATE / 70);

const HANNING = (() => {
  const win = new Float32Array(VOICE_FRAME);
  for (let i = 0; i < VOICE_FRAME; i += 1) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (VOICE_FRAME - 1));
  }
  return win;
})();

export const hasVoice = (samples: Float32Array): boolean => {
  if (samples.length < VOICE_FRAME) return false;
  const count = 1 + Math.floor((samples.length - VOICE_FRAME) / VOICE_HOP);
  const levels = new Float32Array(count);
  const pitched = new Uint8Array(count);
  const frame = new Float32Array(VOICE_FRAME);

  for (let f = 0; f < count; f += 1) {
    const base = f * VOICE_HOP;
    let mean = 0;
    for (let i = 0; i < VOICE_FRAME; i += 1) {
      const val = (samples[base + i] ?? 0) * (HANNING[i] ?? 0);
      frame[i] = val;
      mean += val;
    }
    mean /= VOICE_FRAME;
    let energy = 0;
    for (let i = 0; i < VOICE_FRAME; i += 1) {
      const centered = (frame[i] ?? 0) - mean;
      frame[i] = centered;
      energy += centered * centered;
    }
    levels[f] = Math.sqrt(energy / VOICE_FRAME);
    const r0 = Math.max(energy, 1e-12);
    let dip = 1;
    let best = 0;
    for (let lag = 1; lag < PITCH_HIGH; lag += 1) {
      let sum = 0;
      const limit = VOICE_FRAME - lag;
      for (let i = 0; i < limit; i += 1) {
        sum += (frame[i] ?? 0) * (frame[i + lag] ?? 0);
      }
      const norm = sum / r0;
      if (norm < dip) dip = norm;
      if (lag >= PITCH_LOW && norm - dip > best) {
        best = norm - dip;
      }
    }
    if (best > 0.5) pitched[f] = 1;
  }

  const sorted = Float32Array.from(levels).sort();
  const p20 = sorted[Math.floor((count - 1) * 0.2)] ?? 0;
  const threshold = Math.max(p20 * 2, 0.002);
  let voiced = 0;
  for (let f = 0; f < count; f += 1) {
    if (pitched[f] === 1 && (levels[f] ?? 0) > threshold) {
      voiced += 1;
      if (voiced >= MIN_VOICED_FRAMES) return true;
    }
  }
  return false;
};
