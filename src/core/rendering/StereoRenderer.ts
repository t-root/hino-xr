import * as THREE from "three";
import { voidHex } from "@/ui/theme";
import type { EventBus } from "../events/EventBus";
import type { RuntimeEvents } from "../events/events";
import type { Metrics } from "../observability/metrics";
import { DEFAULT_LENS, type LensSettings, type RenderSettings } from "../state/settings";
import { CoordinateMapper } from "./CoordinateMapper";
import { LensDistortionPass } from "./LensDistortionPass";
import { RenderScene } from "./RenderScene";
import { StereoLayout, type StereoMode } from "./StereoLayout";

export type { StereoMode };

type RenderTick = Readonly<{ nowMs: number; deltaMs: number }>;

/** Mirrors the lens centre offset outward, so one setting serves both eyes. */
const CENTRE_DIRECTION = { left: -1, right: 1, center: 0 } as const;

/**
 * Draws the shared scene once per eye into a side-by-side canvas. The render
 * loop has absolute priority: nothing here awaits inference or module work.
 */
export class StereoRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly renderScene: RenderScene;
  readonly mapper = new CoordinateMapper();
  /** Geometry shared with the DOM interface so both eyes stay identical. */
  readonly layout = new StereoLayout("mono");
  /** Cyclops camera used for hit-testing so both eyes agree on the target. */
  readonly centerCamera: THREE.PerspectiveCamera;

  private readonly leftCamera: THREE.PerspectiveCamera;
  private readonly rightCamera: THREE.PerspectiveCamera;
  private readonly tickListeners = new Set<(tick: RenderTick) => void>();
  private readonly resizeObserver: ResizeObserver;
  private readonly lensPass = new LensDistortionPass();

  private settings: RenderSettings;
  private lens: LensSettings = DEFAULT_LENS;
  private running = false;
  private rafHandle = 0;
  private lastFrameMs = 0;
  private fps = 0;
  private droppedFrames = 0;
  private metricsAccumMs = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly bus: EventBus<RuntimeEvents>,
    private readonly metrics: Metrics,
    settings: RenderSettings,
    lens: LensSettings = DEFAULT_LENS,
  ) {
    this.settings = settings;
    this.lens = lens;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(voidHex(), 1);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    // The interface sits on top of this canvas in the tree, but hit-testing a
    // hand goes through `elementFromPoint`, which returns the topmost element
    // that accepts pointer events. If the canvas claims them, every pinch lands
    // on WebGL and no button ever hears about it.
    this.renderer.domElement.style.pointerEvents = "none";
    container.appendChild(this.renderer.domElement);

    this.renderScene = new RenderScene(settings.videoPlaneDistance, settings.uiPlaneDistance);

    this.centerCamera = new THREE.PerspectiveCamera(lens.fovYDeg, 1, 0.05, 100);
    this.leftCamera = this.centerCamera.clone();
    this.rightCamera = this.centerCamera.clone();

    this.lensPass.setSettings(lens);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  onTick(listener: (tick: RenderTick) => void): () => void {
    this.tickListeners.add(listener);
    return () => this.tickListeners.delete(listener);
  }

  setSettings(settings: RenderSettings, lens: LensSettings = this.lens): void {
    this.settings = settings;
    this.lens = lens;
    this.lensPass.setSettings(lens);
    this.renderScene.setDistances(settings.videoPlaneDistance, settings.uiPlaneDistance);
    this.resize();
  }

  applyTheme(): void {
    this.renderer.setClearColor(voidHex(), 1);
  }

  setMode(mode: StereoMode): void {
    this.layout.setMode(mode);
    this.resize();
  }

  get currentMode(): StereoMode {
    return this.layout.currentMode;
  }

  get currentFps(): number {
    return this.fps;
  }

  setImageAspect(aspect: number): void {
    this.mapper.setLayout({ imageAspect: aspect });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameMs = performance.now();
    this.loop(this.lastFrameMs);
  }

  stop(): void {
    this.running = false;
    if (this.rafHandle) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.tickListeners.clear();
    this.lensPass.dispose();
    this.renderScene.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.layout.setGap(this.lens.eyeGapPx);
    this.layout.setSize(width, height);

    const aspect = this.layout.eyeAspect;
    for (const camera of [this.centerCamera, this.leftCamera, this.rightCamera]) {
      camera.aspect = aspect;
      camera.fov = this.lens.fovYDeg;
      camera.updateProjectionMatrix();
    }

    const eye = this.layout.eyes[0];
    const pixelRatio = this.renderer.getPixelRatio();
    if (eye) this.lensPass.setEyeSize(eye.width * pixelRatio, eye.height * pixelRatio);

    const halfIpd = this.layout.currentMode === "stereo" ? this.settings.ipdMeters / 2 : 0;
    this.leftCamera.position.set(-halfIpd, 0, 0);
    this.rightCamera.position.set(halfIpd, 0, 0);

    this.mapper.setLayout({
      viewportAspect: aspect,
      fovYRad: (this.lens.fovYDeg * Math.PI) / 180,
      videoDistance: this.settings.videoPlaneDistance,
      frameScale: this.lens.frameScale,
    });
  }

  private readonly loop = (nowMs: number): void => {
    if (!this.running) return;
    const deltaMs = nowMs - this.lastFrameMs;
    this.lastFrameMs = nowMs;

    // A gap far above the display interval means the browser skipped frames.
    if (deltaMs > 50) this.droppedFrames += Math.round(deltaMs / 16.7) - 1;
    this.fps = this.fps === 0 ? 1000 / deltaMs : this.fps * 0.9 + (1000 / deltaMs) * 0.1;

    const start = performance.now();
    for (const listener of this.tickListeners) {
      try {
        listener({ nowMs, deltaMs });
      } catch (error) {
        this.bus.emit("diagnostic", {
          level: "error",
          scope: "renderer",
          message: `tick listener failed: ${(error as Error).message}`,
        });
      }
    }
    this.renderEyes();

    const frameMs = performance.now() - start;
    this.metrics.timing("render.frame", frameMs);
    this.metricsAccumMs += deltaMs;
    if (this.metricsAccumMs >= 500) {
      this.metricsAccumMs = 0;
      this.bus.emit("render.metrics", {
        fps: Math.round(this.fps),
        frameMs,
        droppedFrames: this.droppedFrames,
      });
    }

    this.rafHandle = requestAnimationFrame(this.loop);
  };

  private renderEyes(): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    const { scene } = this.renderScene;
    const cameras: Record<string, THREE.PerspectiveCamera> = {
      center: this.centerCamera,
      left: this.leftCamera,
      right: this.rightCamera,
    };

    const neutral = this.lensPass.isNeutral;
    if (neutral) this.renderer.setScissorTest(true);

    for (const eye of this.layout.eyes) {
      // Layout rectangles are measured from the top; GL measures from the bottom.
      const y = size.y - eye.y - eye.height;
      const camera = cameras[eye.id] as THREE.PerspectiveCamera;

      if (neutral) {
        this.renderer.setViewport(eye.x, y, eye.width, eye.height);
        this.renderer.setScissor(eye.x, y, eye.width, eye.height);
        this.renderer.render(scene, camera);
      } else {
        this.lensPass.render(this.renderer, scene, camera, eye, y, CENTRE_DIRECTION[eye.id]);
      }
    }
    this.renderer.setScissorTest(false);
  }
}
