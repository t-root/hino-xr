import type { NormalizedRect } from "../contracts/vision";

const intersectionOverUnion = (a: NormalizedRect, b: NormalizedRect): number => {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (overlap === 0) return 0;
  const union = a.width * a.height + b.width * b.height - overlap;
  return union <= 0 ? 0 : overlap / union;
};

type Track = { id: string; rect: NormalizedRect; missedFrames: number };

/**
 * Greedy IoU tracker. Detectors emit unordered boxes every frame; without stable
 * ids the overlay would recreate and re-animate every box, and selection would
 * jump between objects.
 */
export class IouTracker {
  private readonly tracks: Track[] = [];
  private counter = 0;

  constructor(
    private readonly minIou = 0.3,
    private readonly maxMissedFrames = 6,
  ) {}

  /** Returns one stable id per input rect, in the same order. */
  assign(rects: readonly NormalizedRect[]): readonly string[] {
    const used = new Set<string>();
    const ids: string[] = [];

    for (const rect of rects) {
      let bestTrack: Track | null = null;
      let bestScore = this.minIou;
      for (const track of this.tracks) {
        if (used.has(track.id)) continue;
        const score = intersectionOverUnion(track.rect, rect);
        if (score >= bestScore) {
          bestScore = score;
          bestTrack = track;
        }
      }

      if (bestTrack) {
        bestTrack.rect = rect;
        bestTrack.missedFrames = 0;
        used.add(bestTrack.id);
        ids.push(bestTrack.id);
      } else {
        this.counter += 1;
        const id = `t${this.counter}`;
        this.tracks.push({ id, rect, missedFrames: 0 });
        used.add(id);
        ids.push(id);
      }
    }

    for (let index = this.tracks.length - 1; index >= 0; index -= 1) {
      const track = this.tracks[index];
      if (!track || used.has(track.id)) continue;
      track.missedFrames += 1;
      if (track.missedFrames > this.maxMissedFrames) this.tracks.splice(index, 1);
    }

    return ids;
  }

  reset(): void {
    this.tracks.length = 0;
  }
}
