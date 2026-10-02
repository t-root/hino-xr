import * as THREE from "three";

export const RENDER_ORDER = {
  video: 0,
  overlay: 10,
  ui: 20,
  cursor: 30,
} as const;

/**
 * Scene graph shared by both eyes. Everything is authored once here and drawn
 * twice with per-eye cameras, so the two views never diverge.
 */
export class RenderScene {
  readonly scene = new THREE.Scene();
  /** Holds the video plane and, as children, the detection overlay. */
  readonly videoRoot = new THREE.Group();
  readonly overlayRoot = new THREE.Group();
  /** Panels and the plugin palette, closer to the viewer than the video. */
  readonly uiRoot = new THREE.Group();
  /** Hand cursors, always drawn last and never depth-tested. */
  readonly cursorRoot = new THREE.Group();

  constructor(videoDistance: number, uiDistance: number) {
    this.videoRoot.position.z = -videoDistance;
    this.uiRoot.position.z = -uiDistance;
    this.cursorRoot.position.z = -uiDistance * 0.95;

    this.overlayRoot.renderOrder = RENDER_ORDER.overlay;
    this.uiRoot.renderOrder = RENDER_ORDER.ui;
    this.cursorRoot.renderOrder = RENDER_ORDER.cursor;

    this.videoRoot.add(this.overlayRoot);
    this.scene.add(this.videoRoot, this.uiRoot, this.cursorRoot);
    // No lights: every material is unlit so the single UI colour renders exactly
    // as authored, and the video texture is never tinted by shading.
  }

  setDistances(videoDistance: number, uiDistance: number): void {
    this.videoRoot.position.z = -videoDistance;
    this.uiRoot.position.z = -uiDistance;
    this.cursorRoot.position.z = -uiDistance * 0.95;
  }

  dispose(): void {
    this.scene.traverse((object) => {
      const mesh = object as Partial<THREE.Mesh>;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material?.dispose();
    });
    this.scene.clear();
  }
}
