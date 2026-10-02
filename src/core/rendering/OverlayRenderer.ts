import * as THREE from "three";
import type { Detection, DetectionBatch, NormalizedRect } from "@/shared/contracts/vision";
import { clamp01, lerp } from "@/shared/math/num";
import { ALPHA, uiColorHex } from "@/ui/theme";
import type { InteractiveRegistry } from "../input/InteractiveRegistry";
import type { CoordinateMapper } from "./CoordinateMapper";
import { LabelFactory } from "./labels";
import { RENDER_ORDER } from "./RenderScene";

type OverlayEntry = {
  readonly group: THREE.Group;
  readonly outline: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  readonly picker: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  label: THREE.Sprite | null;
  readonly unregister: () => void;
  /** Display-space rect, smoothed toward the latest detection. */
  rect: NormalizedRect;
  target: NormalizedRect;
  moduleId: string;
  lastSeenMs: number;
  opacity: number;
};

type OverlayState = Readonly<{
  hoveredId: string | null;
  selectedId: string | null;
}>;

const OUTLINE_UNIT_SQUARE = new Float32Array([
  -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, -0.5,
  -0.5, 0,
]);

const SMOOTHING = 0.35;
const FADE_PER_MS = 0.004;

/**
 * Renders normalised detections onto the video plane. Because the overlay is a
 * child of the plane, both eyes get correct parallax from the same scene graph;
 * pixels are never copied from one eye to the other.
 */
export class OverlayRenderer {
  private readonly entries = new Map<string, OverlayEntry>();
  private readonly labels = new LabelFactory();
  private state: OverlayState = { hoveredId: null, selectedId: null };
  private maxBatchAgeMs = 250;

  constructor(
    private readonly root: THREE.Object3D,
    private readonly mapper: CoordinateMapper,
    private readonly registry: InteractiveRegistry,
  ) {}

  setMaxBatchAge(ms: number): void {
    this.maxBatchAgeMs = ms;
  }

  setState(state: OverlayState): void {
    this.state = state;
  }

  /**
   * Accepts a batch. Batches whose source frame is too old are dropped instead
   * of being drawn against a newer camera image.
   */
  submit(batch: DetectionBatch, nowMs: number, currentFrameId: number, frameIntervalMs: number): boolean {
    const ageMs = (currentFrameId - batch.sourceFrameId) * frameIntervalMs;
    if (ageMs > this.maxBatchAgeMs) return false;

    for (const detection of batch.detections) {
      const key = `${batch.moduleId}:${detection.id}`;
      const entry = this.entries.get(key) ?? this.createEntry(key, batch.moduleId, detection);
      entry.target = this.mapper.rectImageToDisplay(detection.bounds);
      entry.lastSeenMs = nowMs;
      entry.moduleId = batch.moduleId;
      this.updateLabel(entry, detection);
    }
    return true;
  }

  /** Drops every entry produced by a module, e.g. when it is disabled. */
  clearModule(moduleId: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.moduleId !== moduleId) continue;
      this.destroyEntry(key, entry);
    }
  }

  clear(): void {
    for (const [key, entry] of this.entries) this.destroyEntry(key, entry);
  }

  applyTheme(): void {
    const hex = uiColorHex();
    this.labels.dispose();
    for (const entry of this.entries.values()) {
      entry.outline.material.color.setHex(hex);
      const label = entry.label;
      if (!label) continue;
      const text = typeof label.userData.text === "string" ? label.userData.text : "";
      if (!text) continue;
      const { texture, aspect } = this.labels.get(text);
      label.material.map = texture;
      label.material.needsUpdate = true;
      label.userData.aspect = aspect;
    }
  }

  /** Called once per rendered frame; smooths boxes and fades stale ones out. */
  update(nowMs: number, deltaMs: number): void {
    const plane = this.mapper.videoPlaneSize();
    for (const [key, entry] of this.entries) {
      const staleMs = nowMs - entry.lastSeenMs;
      const fading = staleMs > this.maxBatchAgeMs;
      entry.opacity = clamp01(entry.opacity + (fading ? -FADE_PER_MS * deltaMs : FADE_PER_MS * deltaMs * 2));
      if (entry.opacity <= 0.001 && fading) {
        this.destroyEntry(key, entry);
        continue;
      }

      entry.rect = {
        x: lerp(entry.rect.x, entry.target.x, SMOOTHING),
        y: lerp(entry.rect.y, entry.target.y, SMOOTHING),
        width: lerp(entry.rect.width, entry.target.width, SMOOTHING),
        height: lerp(entry.rect.height, entry.target.height, SMOOTHING),
      };

      const centre = this.mapper.displayToPlane({
        x: entry.rect.x + entry.rect.width / 2,
        y: entry.rect.y + entry.rect.height / 2,
      });
      const width = Math.max(entry.rect.width * plane.width, 1e-4);
      const height = Math.max(entry.rect.height * plane.height, 1e-4);

      const targetId = entry.group.userData.targetId as string;
      const focused = this.state.hoveredId === targetId || this.state.selectedId === targetId;

      entry.group.position.set(centre.x, centre.y, 0.001);
      // Single-colour rule: focus is expressed with alpha and size, never a hue.
      entry.outline.scale.set(width * (focused ? 1.04 : 1), height * (focused ? 1.04 : 1), 1);
      entry.picker.scale.set(width, height, 1);
      entry.outline.material.opacity = entry.opacity * (focused ? ALPHA.focus : ALPHA.text);

      if (entry.label) {
        const labelHeight = plane.height * 0.035;
        const aspect = entry.label.userData.aspect as number;
        entry.label.scale.set(labelHeight * aspect, labelHeight, 1);
        entry.label.position.set(-width / 2 + (labelHeight * aspect) / 2, height / 2 + labelHeight * 0.7, 0);
        entry.label.material.opacity = entry.opacity;
      }
    }
  }

  dispose(): void {
    this.clear();
    this.labels.dispose();
  }

  private createEntry(key: string, moduleId: string, detection: Detection): OverlayEntry {
    const group = new THREE.Group();
    group.userData.targetId = key;
    group.renderOrder = RENDER_ORDER.overlay;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(OUTLINE_UNIT_SQUARE.slice(), 3));
    const outline = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        color: uiColorHex(),
        transparent: true,
        opacity: 0,
        depthTest: false,
      }),
    );
    outline.renderOrder = RENDER_ORDER.overlay;

    const picker = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false }),
    );
    picker.visible = detection.interaction?.selectable !== false;
    picker.userData.targetId = key;

    group.add(outline, picker);
    this.root.add(group);

    const unregister = this.registry.register({
      id: key,
      kind: "detection",
      object: picker,
      enabled: detection.interaction?.selectable !== false,
      draggable: detection.interaction?.draggable === true,
    });

    const entry: OverlayEntry = {
      group,
      outline,
      picker,
      label: null,
      unregister,
      rect: this.mapper.rectImageToDisplay(detection.bounds),
      target: this.mapper.rectImageToDisplay(detection.bounds),
      moduleId,
      lastSeenMs: 0,
      opacity: 0,
    };
    this.entries.set(key, entry);
    return entry;
  }

  private updateLabel(entry: OverlayEntry, detection: Detection): void {
    const text = detection.label
      ? `${detection.label} ${(detection.confidence * 100).toFixed(0)}%`
      : `${detection.kind} ${(detection.confidence * 100).toFixed(0)}%`;
    if (entry.label && entry.label.userData.text === text) return;

    const { texture, aspect } = this.labels.get(text);
    if (entry.label) {
      entry.label.material.map = texture;
      entry.label.material.needsUpdate = true;
      entry.label.userData.text = text;
      entry.label.userData.aspect = aspect;
      return;
    }

    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
    );
    sprite.renderOrder = RENDER_ORDER.overlay + 1;
    sprite.userData.text = text;
    sprite.userData.aspect = aspect;
    entry.group.add(sprite);
    entry.label = sprite;
  }

  private destroyEntry(key: string, entry: OverlayEntry): void {
    entry.unregister();
    entry.group.removeFromParent();
    entry.outline.geometry.dispose();
    entry.outline.material.dispose();
    entry.picker.geometry.dispose();
    entry.picker.material.dispose();
    entry.label?.material.dispose();
    this.entries.delete(key);
  }
}
