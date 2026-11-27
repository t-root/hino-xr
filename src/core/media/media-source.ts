export type MediaStrategy = "texture" | "opaque";

export type MediaSource =
  | Readonly<{ kind: "video"; url: string; loop?: boolean; muted?: boolean }>
  | Readonly<{ kind: "stream"; stream: MediaStream; label?: string }>
  | Readonly<{ kind: "embed"; url: string }>;

export const strategyFor = (source: MediaSource): MediaStrategy =>
  source.kind === "embed" ? "opaque" : "texture";

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
