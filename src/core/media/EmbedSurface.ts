import { message } from "@/i18n/text";
import type { StereoLayout } from "../rendering/StereoLayout";

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
