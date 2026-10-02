import * as THREE from "three";
import type { Handedness } from "@/shared/contracts/input";
import { clamp01 } from "@/shared/math/num";
import type { NormalizedPoint } from "@/shared/contracts/vision";
import { uiColorHex } from "@/ui/theme";
import type { CoordinateMapper } from "./CoordinateMapper";
import { RENDER_ORDER } from "./RenderScene";

export type CursorPhase = "tracking" | "hover" | "pinching" | "dragging";

export type CursorVisual = Readonly<{
  hand: Handedness;
  /** Display-space position, `0..1`. */
  point: NormalizedPoint;
  phase: CursorPhase;
  /** How far a held pinch has got towards becoming a drag, `0..1`. */
  holdProgress: number;
  confidence: number;
}>;

/** One-shot click burst, ms. Long enough to see, short enough not to trail. */
const FLASH_MS = 240;

type Cursor = {
  readonly frame: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  readonly pip: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  readonly grip: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  readonly flash: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  flashStartedMs: number;
};

/**
 * Hand cursors drawn in front of everything, identically for both eyes.
 *
 * A circle would break the square-only rule and reads as a mouse
 * pointer. This is a HUD reticle: four L-brackets, a square pip that fills as
 * a hold runs, a larger square while dragging, and a one-shot square burst
 * when a press lands. One colour, alpha and size for state, nothing looping.
 */
export class CursorLayer {
  private readonly cursors = new Map<Handedness, Cursor>();

  constructor(
    private readonly root: THREE.Object3D,
    private readonly mapper: CoordinateMapper,
    private readonly cursorDistance: () => number,
    private readonly cursorOpacity: () => number,
    private readonly cursorScale: () => number,
  ) {}

  /** Marks a press that landed on something, at the hand that made it. */
  flash(hand: Handedness, nowMs: number): void {
    const cursor = this.cursors.get(hand);
    if (cursor) cursor.flashStartedMs = nowMs;
  }

  update(visuals: readonly CursorVisual[], nowMs: number): void {
    const seen = new Set<Handedness>();
    // Aim in eye NDC so the ring sits on the same visual spot as the picture
    // (an exception to rules.md A2). DOM widgets use imageToFrame instead.
    const frustum = this.mapper.frustumSize(this.cursorDistance());
    const unit = frustum.height * 0.022 * Math.max(this.cursorScale(), 0.15);
    const alpha = clamp01(this.cursorOpacity());

    for (const visual of visuals) {
      seen.add(visual.hand);
      const cursor = this.cursors.get(visual.hand) ?? this.createCursor(visual.hand);
      const ndc = this.mapper.displayToNdc(visual.point);
      const x = (ndc.x / 2) * frustum.width;
      const y = (ndc.y / 2) * frustum.height;
      const held = visual.phase === "pinching" || visual.phase === "dragging";
      const progress = clamp01(visual.holdProgress);

      const frameScale = held ? 0.72 : visual.phase === "hover" ? 1.18 : 1;
      place(cursor.frame, x, y, unit * frameScale);
      cursor.frame.material.opacity = ((held ? 0.7 : 0.38) + visual.confidence * 0.4) * alpha;

      // The pip fills as the hold runs, so the wearer can see a drag coming and
      // let go in time if a click was what they meant.
      place(cursor.pip, x, y, unit * (0.1 + progress * 0.28));
      cursor.pip.material.opacity = (held ? 0.95 : 0.55) * alpha;

      // Steady, not pulsing: it says "you are holding this", and it says it for
      // as long as the hold lasts.
      place(cursor.grip, x, y, unit * 1.45);
      cursor.grip.material.opacity = 0.5 * alpha;
      cursor.grip.visible = visual.phase === "dragging";

      const elapsed = nowMs - cursor.flashStartedMs;
      const running = cursor.flashStartedMs > 0 && elapsed < FLASH_MS;
      if (running) {
        const t = elapsed / FLASH_MS;
        place(cursor.flash, x, y, unit * (1 + t * 1.35));
        cursor.flash.material.opacity = (1 - t) * 0.85 * alpha;
      }
      cursor.flash.visible = running;
    }

    for (const [hand, cursor] of this.cursors) {
      if (seen.has(hand)) continue;
      for (const mesh of [cursor.frame, cursor.pip, cursor.grip, cursor.flash]) mesh.visible = false;
    }
  }

  applyTheme(): void {
    const hex = uiColorHex();
    for (const cursor of this.cursors.values()) {
      for (const part of [cursor.frame, cursor.pip, cursor.grip, cursor.flash]) {
        part.material.color.setHex(hex);
      }
    }
  }

  dispose(): void {
    for (const cursor of this.cursors.values()) {
      for (const mesh of [cursor.frame, cursor.pip, cursor.grip, cursor.flash]) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
    }
    this.cursors.clear();
  }

  private createCursor(hand: Handedness): Cursor {
    const cursor: Cursor = {
      frame: mesh(bracketsGeometry(), 0.8, RENDER_ORDER.cursor),
      pip: mesh(new THREE.PlaneGeometry(1, 1), 0.6, RENDER_ORDER.cursor + 1),
      grip: mesh(squareRing(1, 0.9), 0.55, RENDER_ORDER.cursor),
      flash: mesh(squareRing(1, 0.88), 0, RENDER_ORDER.cursor + 2),
      flashStartedMs: 0,
    };
    cursor.grip.visible = false;
    cursor.flash.visible = false;
    this.root.add(cursor.frame, cursor.pip, cursor.grip, cursor.flash);
    this.cursors.set(hand, cursor);
    return cursor;
  }
}

const place = (object: THREE.Object3D, x: number, y: number, scale: number): void => {
  object.position.set(x, y, 0);
  object.scale.setScalar(scale);
  object.visible = true;
};

const mesh = <T extends THREE.BufferGeometry>(
  geometry: T,
  opacity: number,
  renderOrder: number,
): THREE.Mesh<T, THREE.MeshBasicMaterial> => {
  const created = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: uiColorHex(), transparent: true, opacity, depthTest: false }),
  );
  created.renderOrder = renderOrder;
  return created;
};

/** Four L-brackets at the corners of a unit square: a HUD lock, not a ring. */
const bracketsGeometry = (): THREE.BufferGeometry => {
  const span = 1;
  const arm = 0.4;
  const thick = 0.07;
  const verts: number[] = [];
  for (const sx of [-1, 1] as const) {
    for (const sy of [-1, 1] as const) {
      const cx = sx * span;
      const cy = sy * span;
      rect(verts, cx - sx * (arm / 2 - thick / 2), cy, arm, thick);
      rect(verts, cx, cy - sy * (arm / 2 - thick / 2), thick, arm);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  return geometry;
};

/** Hollow square of half-size `outer` with a hole of half-size `inner`. */
const squareRing = (outer: number, inner: number): THREE.ShapeGeometry => {
  const shape = new THREE.Shape();
  shape.moveTo(-outer, -outer);
  shape.lineTo(outer, -outer);
  shape.lineTo(outer, outer);
  shape.lineTo(-outer, outer);
  shape.closePath();
  const hole = new THREE.Path();
  hole.moveTo(-inner, -inner);
  hole.lineTo(-inner, inner);
  hole.lineTo(inner, inner);
  hole.lineTo(inner, -inner);
  hole.closePath();
  shape.holes.push(hole);
  return new THREE.ShapeGeometry(shape);
};

const rect = (into: number[], cx: number, cy: number, width: number, height: number): void => {
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  const y0 = cy - height / 2;
  const y1 = cy + height / 2;
  into.push(x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y0, 0, x1, y1, 0, x0, y1, 0);
};
