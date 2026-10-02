import * as THREE from "three";
import { TEXTURE_NEUTRAL_TINT, voidHex } from "@/ui/theme";
import { coverRepeat, type CoordinateMapper } from "./CoordinateMapper";
import { RENDER_ORDER } from "./RenderScene";

/**
 * The camera image as a single shared texture on a plane. Mirroring is applied
 * through texture UVs, never by flipping the mesh, so overlay text stays legible.
 *
 * k1/k2 bow the four edges of this square only. The mesh stays put, so the
 * picture does not slide away from the DOM frame.
 */
export class VideoLayer {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private texture: THREE.VideoTexture | null = null;
  private readonly barrel = { uK1: { value: 0 }, uK2: { value: 0 } };

  constructor(private readonly mapper: CoordinateMapper) {
    const material = new THREE.MeshBasicMaterial({ color: voidHex(), depthWrite: true });
    material.customProgramCacheKey = () => "video-barrel-edges";
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uK1 = this.barrel.uK1;
      shader.uniforms.uK2 = this.barrel.uK2;
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "void main() {",
          "uniform float uK1;\nuniform float uK2;\nvoid main() {",
        )
        .replace(
          "#include <map_fragment>",
          `
#ifdef USE_MAP
	vec2 barrelDelta = vMapUv - vec2( 0.5 );
	float barrelR2 = dot( barrelDelta, barrelDelta );
	float barrelFactor = 1.0 + uK1 * barrelR2 + uK2 * barrelR2 * barrelR2;
	float barrelFit = max( 1.0 + uK1 * 0.25 + uK2 * 0.0625, 1.0 );
	vec2 barrelUv = vec2( 0.5 ) + barrelDelta * barrelFactor / barrelFit;
	vec4 sampledDiffuseColor = texture2D( map, clamp( barrelUv, 0.0, 1.0 ) );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif
`,
        );
    };
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.renderOrder = RENDER_ORDER.video;
    this.mesh.name = "video-plane";
  }

  /** Barrel coefficients. 0 leaves the picture flat; the square does not move. */
  setBarrel(k1: number, k2: number): void {
    this.barrel.uK1.value = k1;
    this.barrel.uK2.value = k2;
  }

  attach(video: HTMLVideoElement, mirrored: boolean, rotationDeg: number): void {
    this.detach();
    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.center.set(0.5, 0.5);
    this.texture = texture;
    this.mesh.material.map = texture;
    this.mesh.material.color.set(TEXTURE_NEUTRAL_TINT);
    this.mesh.material.needsUpdate = true;
    this.applyOrientation(mirrored, rotationDeg);
  }

  /** Updates an already-attached texture when the interface turns. */
  setOrientation(mirrored: boolean, rotationDeg: number): void {
    if (!this.texture) return;
    this.applyOrientation(mirrored, rotationDeg);
  }

  detach(): void {
    this.texture?.dispose();
    this.texture = null;
    this.mesh.material.map = null;
    this.mesh.material.color.set(voidHex());
    this.mesh.material.needsUpdate = true;
  }

  applyTheme(): void {
    if (this.texture) return;
    this.mesh.material.color.setHex(voidHex());
  }

  /** Re-fits the square plane and cover-crops the image onto it. */
  syncSize(): void {
    const { width, height } = this.mapper.videoPlaneSize();
    this.mesh.scale.set(width, height, 1);
    this.applyCoverUv();
  }

  dispose(): void {
    this.detach();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  private applyOrientation(_mirrored: boolean, _rotationDeg: number): void {
    this.applyCoverUv();
  }

  private applyCoverUv(): void {
    const texture = this.texture;
    if (!texture) return;
    const { repeatX, repeatY } = coverRepeat(
      this.mapper.displayAspect,
      this.mapper.currentOrientation.mirrored,
    );
    texture.center.set(0.5, 0.5);
    texture.rotation = 0;
    this.mesh.rotation.z = 0;
    texture.wrapS = repeatX < 0 ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.offset.set(0, 0);
    texture.updateMatrix();
    texture.needsUpdate = true;
  }
}
