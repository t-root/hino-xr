import * as THREE from "three";
import { ALPHA, uiColor } from "@/ui/theme";

const FONT_PX = 48;
const PADDING_X = 18;
const PADDING_Y = 10;

type LabelTexture = Readonly<{
  texture: THREE.CanvasTexture;
  /** Aspect ratio (width / height) of the rendered label. */
  aspect: number;
}>;

/**
 * Labels are drawn into 2D canvases and cached by content, because a headset
 * frame budget cannot absorb re-rasterising text every frame.
 *
 * Both the plate and the text use the one UI colour at different alphas, so the
 * camera image stays visible through every label.
 */
export class LabelFactory {
  private readonly cache = new Map<string, LabelTexture>();

  get(text: string, color = uiColor(ALPHA.text), background = uiColor(ALPHA.surfaceStrong)): LabelTexture {
    const key = `${text}|${color}|${background}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("2D context unavailable for label rendering");

    const font = `600 ${FONT_PX}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    context.font = font;
    const metrics = context.measureText(text);
    canvas.width = Math.ceil(metrics.width + PADDING_X * 2);
    canvas.height = FONT_PX + PADDING_Y * 2;

    context.font = font;
    context.textBaseline = "middle";
    context.fillStyle = background;
    // Square corners, like every other surface in the interface.
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = color;
    context.fillText(text, PADDING_X, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    const entry: LabelTexture = { texture, aspect: canvas.width / canvas.height };
    this.cache.set(key, entry);
    return entry;
  }

  dispose(): void {
    for (const entry of this.cache.values()) entry.texture.dispose();
    this.cache.clear();
  }
}

