/**
 * How a media source can be shown without the two eyes disagreeing (rules.md).
 *
 * - `texture`: we can read its pixels, so it is decoded once and sampled by both
 *   eyes from the same frame. Stereo stays on.
 * - `opaque`: a third-party document whose pixels the browser forbids us to
 *   read. It cannot be decoded once, and two copies would each buffer, seek and
 *   advertise on their own clock. It is shown in a single view instead.
 */
export type MediaStrategy = "texture" | "opaque";

export type MediaSource =
  | Readonly<{ kind: "video"; url: string; loop?: boolean; muted?: boolean }>
  | Readonly<{ kind: "stream"; stream: MediaStream; label?: string }>
  | Readonly<{ kind: "embed"; url: string }>;

export const strategyFor = (source: MediaSource): MediaStrategy =>
  source.kind === "embed" ? "opaque" : "texture";

/** For the log, not for the screen: one line naming what is playing. */
export const describeSource = (source: MediaSource): string => {
  switch (source.kind) {
    case "video":
      return `video ${source.url}`;
    case "stream":
      return source.label ?? "live stream";
    case "embed":
      return `embedded page ${new URL(source.url).host}`;
  }
};
