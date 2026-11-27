import * as THREE from "three";
import { DEFAULT_LENS, type LensSettings } from "../state/settings";
import type { EyeRect } from "./StereoLayout";

const VERTEX_SHADER =  `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER =  `
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

export class LensDistortionPass {
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

  get isNeutral(): boolean {
    return true;
  }

  setSettings(lens: LensSettings): void {
    this.lens = lens;
    const { uniforms } = this.material;
    uniforms.uK1!.value = lens.k1;
    uniforms.uK2!.value = lens.k2;
  }

  setEyeSize(widthPx: number, heightPx: number): void {
    const width = Math.max(Math.floor(widthPx), 1);
    const height = Math.max(Math.floor(heightPx), 1);
    if (this.target.width === width && this.target.height === height) return;
    this.target.setSize(width, height);
    this.material.uniforms.uAspect!.value = width / height;
  }

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
