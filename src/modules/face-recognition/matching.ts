/**
 * Telling whose face it is: nearest neighbour over the faces that were saved.
 *
 * A face is 128 numbers of length one, so two faces compare by their dot product (the cosine of the angle
 * between them): close to 1 for one person, near 0 for two. Each saved person has a few samples; the person is
 * the one whose nearest sample is closest, if that is close enough.
 */

/** The model authors' line between "same person" and "not": a cosine of 0.363. A little above it, to be sure. */
export const MATCH_THRESHOLD = 0.4;

export type Sample = Readonly<{ personId: string; vector: Float32Array }>;

export type Match = Readonly<{ personId: string; similarity: number }>;

/** The numbers a detection carries as base64 text. */
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

/** The saved person the face is closest to, or null when nobody is close enough. */
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

/** A saved sample as numbers, or null when it is not a usable list. */
export const toVector = (values: readonly number[]): Float32Array | null =>
  values.length > 0 && values.every((value) => Number.isFinite(value)) ? Float32Array.from(values) : null;
