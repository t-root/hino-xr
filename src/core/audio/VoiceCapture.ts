import { encodeWav } from "./wav";

export const MIN_TALK_MS = 400;
export const MAX_TALK_MS = 12_000;

type Recording = Readonly<{
  blob: Blob;
  durationMs: number;
}>;

/**
 * Opens the microphone while the wearer has talk switched on.
 *
 * Samples are packed as WAV. Nothing here recognises speech.
 */
export class VoiceCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private mute: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private sampleRate = 48_000;

  async start(): Promise<void> {
    this.abort();
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("no mic");
    }
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
      this.sampleRate = this.context.sampleRate;
      this.source = this.context.createMediaStreamSource(this.stream);
      this.processor = this.context.createScriptProcessor(4096, 1, 1);
      this.processor.onaudioprocess = (event) => {
        this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      this.mute = this.context.createGain();
      this.mute.gain.value = 0;
      this.source.connect(this.processor);
      this.processor.connect(this.mute);
      this.mute.connect(this.context.destination);
    } catch (error) {
      this.abort();
      throw error;
    }
  }

  stop(): Recording {
    const samples = concat(this.chunks);
    const rate = this.sampleRate;
    const durationMs = rate > 0 ? (samples.length / rate) * 1000 : 0;
    this.release();
    return { blob: encodeWav(samples, rate), durationMs };
  }

  abort(): void {
    this.chunks = [];
    this.release();
  }

  private release(): void {
    this.processor?.disconnect();
    this.source?.disconnect();
    this.mute?.disconnect();
    this.processor = null;
    this.source = null;
    this.mute = null;
    if (this.context && this.context.state !== "closed") {
      void this.context.close();
    }
    this.context = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
    }
    this.stream = null;
    this.chunks = [];
  }
}

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
