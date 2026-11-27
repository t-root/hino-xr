import * as THREE from "three";
import { message } from "@/i18n/text";
import type { LocalizedText } from "@/shared/contracts/locale";
import { LocalizedError } from "@/shared/errors/localized";
import { TEXTURE_NEUTRAL_TINT, uiColorHex } from "@/ui/theme";
import { RENDER_ORDER } from "../rendering/RenderScene";
import type { MediaSource } from "./media-source";

const PANEL_HEIGHT = 0.9;
const FALLBACK_ASPECT = 16 / 9;
const METADATA_TIMEOUT_MS = 15_000;

export class VideoSurface {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  private readonly video: HTMLVideoElement;
  private texture: THREE.VideoTexture | null = null;

  constructor(private readonly root: THREE.Object3D) {
    const material = new THREE.MeshBasicMaterial({
      color: uiColorHex(),
      transparent: true,
      opacity: 0.92,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.mesh.renderOrder = RENDER_ORDER.ui;
    this.mesh.name = "media-surface";
    this.mesh.visible = false;

    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.loop = true;
    this.video.crossOrigin = "anonymous";
  }

  get element(): HTMLVideoElement {
    return this.video;
  }

  async play(source: MediaSource): Promise<void> {
    this.close();

    if (source.kind === "stream") {
      this.video.srcObject = source.stream;
    } else if (source.kind === "video") {
      this.video.srcObject = null;
      this.video.loop = source.loop ?? true;
      this.video.muted = source.muted ?? true;
      this.video.src = source.url;
    } else {
      throw new LocalizedError(message("media.error.opaque"));
    }

    await waitForMetadata(this.video);
    await this.video.play();

    const texture = new THREE.VideoTexture(this.video);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    this.texture = texture;

    const aspect = this.video.videoWidth / this.video.videoHeight || FALLBACK_ASPECT;
    this.mesh.scale.set(PANEL_HEIGHT * aspect, PANEL_HEIGHT, 1);
    this.mesh.material.map = texture;
    this.mesh.material.color.set(TEXTURE_NEUTRAL_TINT);
    this.mesh.material.needsUpdate = true;
    this.mesh.visible = true;
    this.root.add(this.mesh);
  }

  close(): void {
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
    this.video.pause();
    this.video.srcObject = null;
    this.video.removeAttribute("src");
    this.video.load();
    this.mesh.material.map = null;
    this.mesh.material.color.set(uiColorHex());
    this.mesh.material.needsUpdate = true;
    this.mesh.visible = false;
    this.mesh.removeFromParent();
  }

  applyTheme(): void {
    if (this.texture) return;
    this.mesh.material.color.setHex(uiColorHex());
  }

  dispose(): void {
    this.close();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

const waitForMetadata = (video: HTMLVideoElement): Promise<void> => {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => fail(message("media.error.timeout")), METADATA_TIMEOUT_MS);

    const done = (): void => {
      clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onLoad);
      video.removeEventListener("error", onError);
    };
    const onLoad = (): void => {
      done();
      resolve();
    };
    const fail = (text: LocalizedText): void => {
      done();
      reject(new LocalizedError(text));
    };
    const onError = (): void => fail(message("media.error.load"));

    video.addEventListener("loadedmetadata", onLoad, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
};
