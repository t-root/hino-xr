export const MATCH_THRESHOLD = 0.4;

export type Sample = Readonly<{ personId: string; vector: Float32Array }>;

export type Match = Readonly<{ personId: string; similarity: number }>;

export const decodeEmbedding = (text: string): Float32Array | null => {
  try {
    const raw = atob(text);
    if (raw.length === 0 || raw.length % 4 !== 0) return null;
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return new Float32Array(bytes.buffer);
  } catch {
    return null;
  }
};

export const cosine = (a: Float32Array, b: Float32Array): number => {
  if (a.length !== b.length) return -1;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] as number) * (b[i] as number);
  return sum;
};

export const bestMatch = (face: Float32Array, samples: readonly Sample[], threshold = MATCH_THRESHOLD): Match | null => {
  let best: Match | null = null;
  for (const sample of samples) {
    const similarity = cosine(face, sample.vector);
    if (similarity >= threshold && (!best || similarity > best.similarity)) {
      best = { personId: sample.personId, similarity };
    }
  }
  return best;
};

export const toVector = (values: readonly number[]): Float32Array | null =>
  values.length > 0 && values.every((value) => Number.isFinite(value)) ? Float32Array.from(values) : null;
