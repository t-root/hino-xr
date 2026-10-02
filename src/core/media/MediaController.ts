import type * as THREE from "three";
import type { EventBus } from "../events/EventBus";
import type { RuntimeEvents } from "../events/events";
import { createLogger } from "../observability/diagnostics";
import type { StereoLayout } from "../rendering/StereoLayout";
import { EmbedSurface } from "./EmbedSurface";
import { describeSource, strategyFor, type MediaSource, type MediaStrategy } from "./media-source";
import { VideoSurface } from "./VideoSurface";

type MediaPlayback = Readonly<{
  strategy: MediaStrategy;
  description: string;
}>;

/**
 * Routes any media source down the only path that keeps both eyes identical
 * (rules.md): readable pixels are decoded once and drawn per eye, and anything
 * whose pixels are off limits is shown in a single view.
 *
 * There is no third path, and never more than one player, so "the two eyes show
 * different frames" is not a state this runtime can reach.
 */
export class MediaController {
  private readonly logger;
  private readonly video: VideoSurface;
  private readonly embed: EmbedSurface;
  private playback: MediaPlayback | null = null;

  constructor(
    bus: EventBus<RuntimeEvents>,
    uiRoot: THREE.Object3D,
    embedHost: HTMLElement,
    layout: StereoLayout,
  ) {
    this.logger = createLogger("media", bus);
    this.video = new VideoSurface(uiRoot);
    this.embed = new EmbedSurface(embedHost, layout);
  }

  get current(): MediaPlayback | null {
    return this.playback;
  }

  async open(source: MediaSource): Promise<MediaPlayback> {
    this.close();
    const description = describeSource(source);
    const strategy = strategyFor(source);

    if (strategy === "opaque") {
      this.embed.open((source as Extract<MediaSource, { kind: "embed" }>).url);
    } else {
      await this.video.play(source);
    }

    this.playback = { strategy, description };
    this.logger.debug("media opened", { strategy });
    return this.playback;
  }

  close(): void {
    this.video.close();
    this.embed.close();
    this.playback = null;
  }

  dispose(): void {
    this.video.dispose();
    this.embed.dispose();
    this.playback = null;
  }

  applyTheme(): void {
    this.video.applyTheme();
  }
}
