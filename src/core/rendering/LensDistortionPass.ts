import * as THREE from "three";
import { DEFAULT_LENS, type LensSettings } from "../state/settings";
import type { EyeRect } from "./StereoLayout";

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * Barrel pre-distortion. A magnifying lens bends straight lines outward
 * (pincushion), so the image is bent inward by the same amount first and the
 * two cancel.
 *
 * This pass must not darken or zoom the camera: no black fill, no vignette,
 * no extra scale. Out-of-range samples clamp to the edge. k1/k2 only bend
 * lines — the mid-edge of the picture still maps to the mid-edge of the eye.
 */
const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
uniform sampler2D tDiffuse;
uniform vec2 uCenter;
uniform float uK1;
uniform float uK2;
uniform float uAspect;
varying vec2 vUv;

void main() {
  vec2 offset = (vUv - uCenter) * vec2(uAspect, 1.0);
  float r2 = dot(offset, offset);
  float factor = 1.0 + uK1 * r2 + uK2 * r2 * r2;
  float r2Fit = min(0.25 * uAspect * uAspect, 0.25);
  float fit = 1.0 + uK1 * r2Fit + uK2 * r2Fit * r2Fit;
  vec2 source = uCenter + (vUv - uCenter) * factor / max(fit, 1.0);
  gl_FragColor = texture2D(tDiffuse, clamp(source, 0.0, 1.0));
  // The eye was drawn into a linear target. Write sRGB to the canvas the same
  // way MeshBasicMaterial does, or this copy looks darker than a direct blit.
  #include <colorspace_fragment>
}
`;

/**
 * Renders one eye through the headset optics.
 *
 * The eye is drawn into an off-screen target, then blitted into its viewport
 * through the distortion shader. Both eyes go through the same pass with the
 * same numbers — only the lens centre is mirrored — so warping cannot make the
 * two views disagree (rules.md).
 */
export class LensDistortionPass {
  /** Public so the optics can be inspected without reaching into the pass. */
  readonly material: THREE.ShaderMaterial;

  private readonly quadScene = new THREE.Scene();
  private readonly quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly target: THREE.WebGLRenderTarget;
  private lens: LensSettings = DEFAULT_LENS;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      colorSpace: THREE.LinearSRGBColorSpace,
    });

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tDiffuse: { value: this.target.texture },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uK1: { value: 0 },
        uK2: { value: 0 },
        uAspect: { value: 1 },
      },
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /**
   * True while the optics do nothing observable, so the renderer can skip
   * a full-screen copy per eye.
   */
  get isNeutral(): boolean {
    // k1/k2 bow the camera picture on the video plane, not this full-eye copy.
    // A blit here would slide the square away from the DOM frame.
    return true;
  }

  setSettings(lens: LensSettings): void {
    this.lens = lens;
    const { uniforms } = this.material;
    uniforms.uK1!.value = lens.k1;
    uniforms.uK2!.value = lens.k2;
  }

  /** Sized to one eye: both eyes are identical, so a single target serves both. */
  setEyeSize(widthPx: number, heightPx: number): void {
    const width = Math.max(Math.floor(widthPx), 1);
    const height = Math.max(Math.floor(heightPx), 1);
    if (this.target.width === width && this.target.height === height) return;
    this.target.setSize(width, height);
    this.material.uniforms.uAspect!.value = width / height;
  }

  /**
   * `centreDirection` is -1 for the left eye and +1 for the right, so a single
   * offset moves both lens centres outward symmetrically.
   */
  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    eye: EyeRect,
    viewportY: number,
    centreDirection: -1 | 0 | 1,
  ): void {
    renderer.setScissorTest(false);
    renderer.setRenderTarget(this.target);
    renderer.setViewport(0, 0, this.target.width, this.target.height);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);

    this.material.uniforms.uCenter!.value.set(0.5 + centreDirection * this.lens.lensCenterOffset, 0.5);
    renderer.setViewport(eye.x, viewportY, eye.width, eye.height);
    renderer.setScissor(eye.x, viewportY, eye.width, eye.height);
    renderer.setScissorTest(true);
    renderer.render(this.quadScene, this.quadCamera);
  }

  dispose(): void {
    this.target.dispose();
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}
