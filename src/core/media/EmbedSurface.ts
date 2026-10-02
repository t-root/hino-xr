import { message } from "@/i18n/text";
import type { StereoLayout } from "../rendering/StereoLayout";

/**
 * A third-party page shown in a single frame (rules.md).
 *
 * The browser will not let us read an iframe's pixels, so the "decode once, draw
 * twice" route is closed. Two iframes would be two players with their own
 * buffering, ads and adaptive quality, and no message passing brings them to the
 * same frame. So there is exactly one iframe, and while it is on screen the
 * layout is pinned to one viewport: no second eye exists to disagree with.
 */
export class EmbedSurface {
  private frame: HTMLIFrameElement | null = null;
  private releaseMono: (() => void) | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly layout: StereoLayout,
  ) {}

  open(url: string): void {
    this.close();

    const frame = document.createElement("iframe");
    frame.className = "embed-surface";
    frame.src = url;
    frame.allow = "autoplay; encrypted-media; picture-in-picture";
    frame.referrerPolicy = "no-referrer";
    this.host.appendChild(frame);
    this.frame = frame;

    this.releaseMono = this.layout.requireMono(message("mono.embed"));
  }

  close(): void {
    this.releaseMono?.();
    this.releaseMono = null;
    this.frame?.remove();
    this.frame = null;
  }

  dispose(): void {
    this.close();
  }
}
