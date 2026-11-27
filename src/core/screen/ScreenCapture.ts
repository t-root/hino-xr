export type CameraView = Readonly<{
  video: HTMLVideoElement;
  mirrored: boolean;
  turn?: 0 | 90 | 180 | 270;
}>;

let cameraView: (() => CameraView | null) | null = null;

export const setCameraView = (provider: (() => CameraView | null) | null): void => {
  cameraView = provider;
};

const MAX_SIDE = 1280;
const JPEG_QUALITY = 0.82;

const SVG_NS = "http://www.w3.org/2000/svg";

const pageCss = (): string => {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      parts.push(Array.from(sheet.cssRules, (rule) => rule.cssText).join("\n"));
    } catch {
    }
  }
  return parts.join("\n");
};

const freezeCanvases = (live: ParentNode, copy: ParentNode): void => {
  const from = Array.from(live.querySelectorAll("canvas"));
  const to = Array.from(copy.querySelectorAll("canvas"));
  from.forEach((canvas, index) => {
    const twin = to[index];
    if (!twin) return;
    const image = document.createElement("img");
    try {
      image.src = canvas.toDataURL("image/png");
    } catch {
      twin.remove();
      return;
    }
    image.setAttribute("style", twin.getAttribute("style") ?? "");
    image.className = twin.className;
    image.width = canvas.clientWidth || canvas.width;
    image.height = canvas.clientHeight || canvas.height;
    twin.replaceWith(image);
  });
};

const loadImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("the page could not be drawn into a picture"));
    image.src = url;
  });

const cameraRect = (): DOMRect | null => {
  const frame = document.querySelector<HTMLElement>(".stereo-dom .eye .camera-frame");
  const rect = frame?.getBoundingClientRect();
  return rect && rect.width > 8 && rect.height > 8 ? rect : null;
};

const drawCamera = (
  context: CanvasRenderingContext2D,
  view: CameraView,
  where: Readonly<{ x: number; y: number; width: number; height: number }>,
): void => {
  const { video } = view;
  const side = Math.min(video.videoWidth, video.videoHeight);
  if (side <= 0 || video.readyState < 2) return;
  const sx = (video.videoWidth - side) / 2;
  const sy = (video.videoHeight - side) / 2;
  const turn = view.turn ?? 0;
  context.save();
  context.translate(where.x + where.width / 2, where.y + where.height / 2);
  if (turn !== 0) {
    context.rotate((turn * Math.PI) / 180);
  }
  if (view.mirrored) {
    context.scale(-1, 1);
  }
  context.drawImage(video, sx, sy, side, side, -where.width / 2, -where.height / 2, where.width, where.height);
  context.restore();
};

const targetRect = (): DOMRect => {
  const eye = document.querySelector<HTMLElement>(".stereo-dom .eye");
  const rect = eye?.getBoundingClientRect();
  if (rect && rect.width > 8 && rect.height > 8) return rect;
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
};

export const captureScreen = async (): Promise<string> => {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  const rect = targetRect();
  const copy = document.body.cloneNode(true) as HTMLElement;
  freezeCanvases(document.body, copy);
  copy.querySelectorAll("script, video").forEach((node) => node.remove());
  copy.style.margin = "0";
  copy.style.width = `${width}px`;
  copy.style.height = `${height}px`;
  copy.style.background = "transparent";

  const style = document.createElement("style");
  style.textContent = pageCss();
  const root = document.createElementNS(SVG_NS, "svg");
  root.setAttribute("xmlns", SVG_NS);
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  const object = document.createElementNS(SVG_NS, "foreignObject");
  object.setAttribute("width", "100%");
  object.setAttribute("height", "100%");
  const holder = document.createElement("div");
  holder.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  holder.append(style, copy);
  object.append(holder);
  root.append(object);

  const markup = new XMLSerializer().serializeToString(root);
  const picture = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`);

  const cut = {
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.max(1, Math.min(width, Math.ceil(rect.width))),
    height: Math.max(1, Math.min(height, Math.ceil(rect.height))),
  };
  const scale = Math.min(1, MAX_SIDE / Math.max(cut.width, cut.height));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(cut.width * scale));
  out.height = Math.max(1, Math.round(cut.height * scale));
  const context = out.getContext("2d");
  if (!context) throw new Error("no canvas to draw the picture on");
  const view = cameraView?.() ?? null;
  const square = cameraRect();
  if (view && square) {
    const at = { x: (square.x - cut.x) * scale, y: (square.y - cut.y) * scale, width: square.width * scale, height: square.height * scale };
    drawCamera(context, view, at);
  }
  context.drawImage(picture, cut.x, cut.y, cut.width, cut.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1] ?? "";
};
