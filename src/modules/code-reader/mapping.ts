import type { Detection } from "@/shared/contracts/vision";
import { normalizeBox } from "@/shared/math/box";

type Point = Readonly<{ x: number; y: number }>;

export type RawCode = Readonly<{
  isValid: boolean;
  text: string;
  format: string;
  position: Readonly<{ topLeft: Point; topRight: Point; bottomRight: Point; bottomLeft: Point }>;
}>;

type Options = Readonly<{ imageWidth: number; imageHeight: number; maxResults: number }>;

export const toCodeDetections = (raw: readonly RawCode[], options: Options): Detection[] => {
  const detections: Detection[] = [];
  for (const code of raw) {
    if (detections.length >= options.maxResults) break;
    if (!code.isValid || code.text === "") continue;
    const corners = [code.position.topLeft, code.position.topRight, code.position.bottomRight, code.position.bottomLeft];
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const bounds = normalizeBox(
      { originX: left, originY: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top },
      options.imageWidth,
      options.imageHeight,
    );
    if (!bounds) continue;
    detections.push({
      id: `${detections.length}`,
      kind: "code",
      bounds,
      confidence: 1,
      attributes: { text: code.text, format: code.format, plainLabel: true },
      interaction: { selectable: true },
    });
  }
  return detections;
};
