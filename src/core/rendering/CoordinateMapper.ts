import type { FrameRotation, NormalizedPoint, NormalizedRect } from "@/shared/contracts/vision";

type FitMode = "cover" | "contain";

type FrameOrientation = Readonly<{
  mirrored: boolean;
  rotationDeg: FrameRotation;
}>;

type ViewLayout = Readonly<{
  /** Aspect of a single eye viewport (width / height). */
  viewportAspect: number;
  /** Aspect of the raw camera image, before rotation. */
  imageAspect: number;
  /** Vertical field of view of the eye cameras, radians. */
  fovYRad: number;
  /** Distance of the video plane from the eye, metres. */
  videoDistance: number;
  fit: FitMode;
  /** Size of the square camera frame. 1 is the largest square in the eye. */
  frameScale: number;
}>;

export type Size = Readonly<{ width: number; height: number }>;

type LayoutListener = () => void;

const DEFAULT_ORIENTATION: FrameOrientation = { mirrored: false, rotationDeg: 0 };

const sameLayout = (a: ViewLayout, b: ViewLayout): boolean =>
  a.viewportAspect === b.viewportAspect &&
  a.imageAspect === b.imageAspect &&
  a.fovYRad === b.fovYRad &&
  a.videoDistance === b.videoDistance &&
  a.fit === b.fit &&
  a.frameScale === b.frameScale;

const sameOrientation = (a: FrameOrientation, b: FrameOrientation): boolean =>
  a.mirrored === b.mirrored && a.rotationDeg === b.rotationDeg;

/**
 * Where the camera picture sits inside one eye, as a fraction of that eye.
 *
 * This rectangle is the parent of everything that is drawn for the wearer:
 * boot HUD, menu, diagnostics. The rest of the eye stays black. Widgets must
 * not recompute it; they mount into the box `StereoView` places from this value.
 *
 * Inverse of `contentRect`: that one is the visible slice of the *image*;
 * this is the slice of the *eye* the image occupies.
 *
 * Worked example: square eye, 16:9 contain
 * → `{ x: 0, y: 0.21875, width: 1, height: 0.5625 }`.
 *
 * The camera frame itself is always a square: `squareFrameSize` then this
 * mapping. Zooming the frame changes that square's size, not the image crop.
 */
const cameraFrameInEye = (frustum: Size, plane: Size): NormalizedRect => {
  const width = Math.min(1, plane.width / frustum.width);
  const height = Math.min(1, plane.height / frustum.height);
  return { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
};

/** Largest square that fits in the eye, then scaled. Always 1:1. */
const squareFrameSize = (frustum: Size, frameScale: number): Size => {
  const side = Math.min(frustum.width, frustum.height) * frameScale;
  return { width: side, height: side };
};

/**
 * Texture repeat that covers a square plane with an image of this aspect,
 * around UV centre 0.5. Landscape crops the sides; portrait crops top/bottom.
 * The mesh stays 1:1 — this is not an image zoom.
 */
export const coverRepeat = (aspect: number, mirrored: boolean): Readonly<{ repeatX: number; repeatY: number }> => {
  let repeatX = 1;
  let repeatY = 1;
  if (aspect > 1) repeatX = 1 / aspect;
  else if (aspect > 0 && aspect < 1) repeatY = aspect;
  if (mirrored) repeatX = -repeatX;
  return { repeatX, repeatY };
};

/** Visible slice of a cover-fitted image on a square, in display space. */
const coverContentRect = (aspect: number): NormalizedRect => {
  if (aspect >= 1) {
    const width = 1 / aspect;
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
  const height = aspect;
  return { x: 0, y: (1 - height) / 2, width: 1, height };
};

/**
 * Pixel box for `.camera-frame`. Floors origin, ceils size, then grows by
 * `bleed` so a CSS overlay cannot leave a 1px strip of the WebGL picture.
 */
const cameraFramePx = (
  frame: NormalizedRect,
  eye: Size,
  bleed = 2,
): Record<string, string> => ({
  left: `${Math.floor(frame.x * eye.width) - bleed}px`,
  top: `${Math.floor(frame.y * eye.height) - bleed}px`,
  width: `${Math.ceil(frame.width * eye.width) + bleed * 2}px`,
  height: `${Math.ceil(frame.height * eye.height) + bleed * 2}px`,
});

/**
 * The only place allowed to reason about mirror, rotation, fit and crop.
 *
 * Pipeline: raw image → mirror → rotation → display space (`0..1`, upright as the
 * user sees it) → video plane local metres → NDC of an eye viewport.
 *
 * The camera picture — not the square eye, not the window — is the coordinate
 * parent for every overlay. `frameInEye()` / `.camera-frame` is that parent
 * (rules.md). DOM widgets mount there.
 */
export class CoordinateMapper {
  private orientation: FrameOrientation = DEFAULT_ORIENTATION;
  private layout: ViewLayout = {
    viewportAspect: 1,
    imageAspect: 16 / 9,
    fovYRad: (60 * Math.PI) / 180,
    videoDistance: 3,
    // Cover the square frame so the picture fills it. Contain would letterbox
    // inside the square, which reads as a themed inset.
    fit: "cover",
    frameScale: 1,
  };
  private readonly listeners = new Set<LayoutListener>();

  setOrientation(orientation: FrameOrientation): void {
    if (sameOrientation(this.orientation, orientation)) return;
    this.orientation = orientation;
    this.notify();
  }

  setLayout(layout: Partial<ViewLayout>): void {
    const next = { ...this.layout, ...layout };
    if (sameLayout(this.layout, next)) return;
    this.layout = next;
    this.notify();
  }

  readonly subscribe = (listener: LayoutListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get currentOrientation(): FrameOrientation {
    return this.orientation;
  }

  /** Image aspect as displayed: a quarter turn swaps width and height. */
  get displayAspect(): number {
    const { rotationDeg } = this.orientation;
    return rotationDeg === 90 || rotationDeg === 270 ? 1 / this.layout.imageAspect : this.layout.imageAspect;
  }

  imageToDisplay(point: NormalizedPoint): NormalizedPoint {
    const x = this.orientation.mirrored ? 1 - point.x : point.x;
    const y = point.y;
    switch (this.orientation.rotationDeg) {
      case 90:
        return { x: 1 - y, y: x };
      case 180:
        return { x: 1 - x, y: 1 - y };
      case 270:
        return { x: y, y: 1 - x };
      default:
        return { x, y };
    }
  }

  rectImageToDisplay(rect: NormalizedRect): NormalizedRect {
    const a = this.imageToDisplay({ x: rect.x, y: rect.y });
    const b = this.imageToDisplay({ x: rect.x + rect.width, y: rect.y + rect.height });
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x, y, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
  }

  /** Size of the eye frustum at a given distance, in metres. */
  frustumSize(distance: number): Size {
    const height = 2 * distance * Math.tan(this.layout.fovYRad / 2);
    return { width: height * this.layout.viewportAspect, height };
  }

  /** Square camera frame in metres. Zoom changes this size; the image crop does not follow. */
  frameSquareSize(): Size {
    return squareFrameSize(this.frustumSize(this.layout.videoDistance), this.layout.frameScale);
  }

  /** Square mesh. The image covers it through texture UVs, so the picture stays 1:1. */
  videoPlaneSize(): Size {
    return this.frameSquareSize();
  }

  /**
   * Square camera frame inside the eye, as a fraction of the eye viewport.
   * StereoView parents the interface to this rectangle. Nothing else may invent one.
   */
  frameInEye(): NormalizedRect {
    return cameraFrameInEye(this.frustumSize(this.layout.videoDistance), this.frameSquareSize());
  }

  /** Pixel box for `.camera-frame`, snapped and bled so the veil cannot leak. */
  framePx(eye: Size, bleed = 2): Record<string, string> {
    return cameraFramePx(this.frameInEye(), eye, bleed);
  }

  /**
   * Portion of the image actually visible after cover-cropping, in display space.
   * Overlay culling and "detection outside view" hints use this.
   */
  contentRect(): NormalizedRect {
    return this.layout.fit === "cover"
      ? coverContentRect(this.displayAspect)
      : { x: 0, y: 0, width: 1, height: 1 };
  }

  /** Display-space point → position on the square video plane, in metres, plane-local. */
  displayToPlane(point: NormalizedPoint): { x: number; y: number } {
    const content = this.contentRect();
    const plane = this.videoPlaneSize();
    const u = content.width > 0 ? (point.x - content.x) / content.width : 0.5;
    const v = content.height > 0 ? (point.y - content.y) / content.height : 0.5;
    return { x: (u - 0.5) * plane.width, y: (0.5 - v) * plane.height };
  }

  /** Display-space point → normalised device coordinates of an eye viewport. */
  displayToNdc(point: NormalizedPoint): NormalizedPoint {
    const frustum = this.frustumSize(this.layout.videoDistance);
    const local = this.displayToPlane(point);
    return { x: (local.x / frustum.width) * 2, y: (local.y / frustum.height) * 2 };
  }

  /**
   * Display-space point → `0..1` on the camera square (the same box as
   * `.camera-frame`). Hand hits on the DOM interface use this, not eye NDC.
   */
  displayToFrame(point: NormalizedPoint): NormalizedPoint {
    const plane = this.videoPlaneSize();
    const local = this.displayToPlane(point);
    return {
      x: plane.width > 0 ? local.x / plane.width + 0.5 : 0.5,
      y: plane.height > 0 ? 0.5 - local.y / plane.height : 0.5,
    };
  }

  imageToFrame(point: NormalizedPoint): NormalizedPoint {
    return this.displayToFrame(this.imageToDisplay(point));
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
