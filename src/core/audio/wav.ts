/**
 * PCM WAV container. This is packing samples into a header, not a speech model.
 * Transcription and synthesis stay on the Core server.
 */
export const encodeWav = (samples: Float32Array, sampleRate: number): Blob => {
  const rate = Math.max(1, Math.round(sampleRate));
  const count = samples.length;
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, count * 2, true);
  let offset = 44;
  for (let i = 0; i < count; i += 1) {
    const clipped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
};

const writeAscii = (view: DataView, offset: number, text: string): void => {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
};
