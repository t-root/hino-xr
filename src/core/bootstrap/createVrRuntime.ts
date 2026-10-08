import { LocalizedError, localizedTextOf } from "@/shared/errors/localized";
import { CameraController, DEFAULT_CAMERA_REQUEST } from "../camera/CameraController";
import { FrameHub } from "../camera/FrameHub";
import type { CameraRequest } from "../camera/types";
import { TypedEventBus } from "../events/EventBus";
import type { RuntimeEvents } from "../events/events";
import { DomPointerSurface } from "../input/DomPointerSurface";
import { HandTrackingService } from "../input/HandTrackingService";
import { HitTestService } from "../input/HitTestService";
import { InteractionManager } from "../input/InteractionManager";
import { InteractiveRegistry } from "../input/InteractiveRegistry";
import { MediaController } from "../media/MediaController";
import { ModuleManager } from "../modules/ModuleManager";
import { ModuleRegistry } from "../modules/module-registry";
import { ModuleScreenHost } from "../modules/ModuleScreenHost";
import { RuntimeMetrics } from "../observability/metrics";
import { PluginPaletteController } from "../plugin-palette/PluginPaletteController";
import { CursorLayer } from "../rendering/CursorLayer";
import { OverlayRenderer } from "../rendering/OverlayRenderer";
import { StereoRenderer } from "../rendering/StereoRenderer";
import { VideoLayer } from "../rendering/VideoLayer";
import { currentLocale, useLocaleStore } from "../state/LocaleStore";
import { useRuntimeStore } from "../state/RuntimeStore";
import { loadSettings, type Settings } from "../state/settings";
import { applyTheme } from "@/ui/theme";
import { useSharedUiStore } from "../state/SharedUiStore";
import { detectCapabilities, findBlockers } from "./capabilities";
import { DeviceAccess } from "../device/DeviceAccess";
import { AutoOrientation } from "../view/AutoOrientation";
import { ModelBridge } from "../models/ModelBridge";
import { WakeController } from "../models/WakeController";
import { registerBuiltInModules } from "@/modules/registry";

type VrRuntime = Readonly<{
  bus: TypedEventBus<RuntimeEvents>;
  metrics: RuntimeMetrics;
  registry: ModuleRegistry;
  modules: ModuleManager;
  renderer: StereoRenderer;
  /** Video and embedded content, kept in sync across eyes (rules.md). */
  media: MediaController;
  /** Puts plugin screens into one eye's camera frame; called per eye. */
  mountScreens: (frame: HTMLElement) => () => void;
  /** Language models on the Core server. The web only posts messages. */
  models: ModelBridge;
  /** What the microphone is waiting for: "system call", then the assistant's name. */
  wake: WakeController;
  /**
   * Sensor, location and wake-lock prompts. Must run inside the Start tap,
   * before fullscreen or the camera spend that gesture.
   */
  claimDeviceAccess: () => Promise<void>;
  /** Opens the camera and starts the picture. Nothing else is switched on. */
  startCamera: (request?: CameraRequest) => Promise<void>;
  /** The rest of the system: hand tracking. Called once the wearer has said "system call". */
  startHands: () => Promise<void>;
  stop: () => void;
  applySettings: (settings: Settings) => void;
  /** Show the camera after boot; the world stays black until this is called. */
  revealWorld: () => void;
  dispose: () => void;
}>;

/**
 * Composition root. Every dependency is created and wired here so the rest of
 * the codebase never reaches for a global, and the whole runtime can be torn
 * down deterministically.
 */
export const createVrRuntime = (container: HTMLElement): VrRuntime => {
  const store = useRuntimeStore.getState();
  let settings = loadSettings();
  store.updateSettings(settings);
  store.setViewTurn(settings.view.rotation);
  applyTheme(settings.theme);

  const bus = new TypedEventBus<RuntimeEvents>();
  const metrics = new RuntimeMetrics();

  const deviceAccess = new DeviceAccess(bus, (grants) => {
    useRuntimeStore.getState().setDeviceGrants(grants);
  });
  const autoOrientation = new AutoOrientation(settings.view.rotation, (turn) => {
    useRuntimeStore.getState().setViewTurn(turn);
  });

  const renderer = new StereoRenderer(container, bus, metrics, settings.render, settings.lens);
  const registry = new InteractiveRegistry();
  const videoLayer = new VideoLayer(renderer.mapper);
  videoLayer.setBarrel(settings.lens.k1, settings.lens.k2);
  videoLayer.mesh.visible = false;
  renderer.renderScene.videoRoot.add(videoLayer.mesh);
  renderer.renderScene.overlayRoot.visible = false;
  renderer.renderScene.uiRoot.visible = false;
  renderer.renderScene.cursorRoot.visible = false;

  const cursors = new CursorLayer(
    renderer.renderScene.cursorRoot,
    renderer.mapper,
    () => settings.render.uiPlaneDistance * 0.95,
    () => settings.cursor.opacity,
    () => settings.cursor.scale,
  );
  // Detection boxes live on the video plane, so both eyes draw them from the
  // one scene graph with the right parallax (rules.md).
  const overlay = new OverlayRenderer(renderer.renderScene.overlayRoot, renderer.mapper, registry);
  overlay.setMaxBatchAge(settings.render.maxBatchAgeMs);
  const hitTest = new HitTestService(registry, renderer.centerCamera, renderer.mapper);
  const surface = new DomPointerSurface(container.ownerDocument, (point) =>
    renderer.mapper.imageToFrame({ x: point.x, y: point.y }),
  );
  const interaction = new InteractionManager(
    bus,
    registry,
    hitTest,
    cursors,
    (point) => renderer.mapper.imageToDisplay(point),
    settings.gesture,
    settings.snap,
    settings.flags.snapGesture,
    surface,
  );

  // Third-party embeds live here: inside the stage, so they sit under the
  // interface, and outside the per-eye boxes, so they are never duplicated.
  const embedHost = document.createElement("div");
  embedHost.className = "embed-host";
  container.appendChild(embedHost);
  const media = new MediaController(bus, renderer.renderScene.uiRoot, embedHost, renderer.layout);
  const models = new ModelBridge();
  const wake = new WakeController(models);

  const camera = new CameraController(bus);
  const frameHub = new FrameHub(bus, {
    analysisMaxSize: settings.pipeline.analysisMaxSize,
    metrics,
  });

  // A plugin screen covers the menu it was switched on from, so opening one
  // closes the menu; the snap or the screen's own close button brings it back.
  const screens = new ModuleScreenHost(
    (id) => void modules.disable(id),
    () => useSharedUiStore.getState().setMenuOpen(false),
    (id, error) => modules.fail(id, error),
  );

  const moduleRegistry = new ModuleRegistry();
  registerBuiltInModules(moduleRegistry);
  const modules = new ModuleManager(
    bus,
    moduleRegistry,
    frameHub,
    metrics,
    () => settings.pipeline.moduleFps,
    currentLocale,
    (id) => screens.create(id),
  );

  const palette = new PluginPaletteController(moduleRegistry, modules);

  // The settings menu lists plugins. There is no 3D palette of cards.
  const publishPlugins = () => useRuntimeStore.getState().setPlugins(palette.items());
  publishPlugins();

  const handTracking = new HandTrackingService(bus, metrics);

  let unregisterHandConsumer: (() => void) | null = null;
  let frameIntervalMs = 1000 / 30;
  let lastFrameId = 0;
  let lastFrameTimestampMs = 0;

  handTracking.onHands((hands) => interaction.ingest(hands));

  const unsubscribes = [
    bus.on("camera.state", ({ state, error, deviceLabel }) => {
      const message = error ? localizedTextOf(error) : null;
      useRuntimeStore.getState().setCameraState(state, message, deviceLabel);
    }),
    bus.on("module.state", ({ moduleId, state }) => {
      // A plugin that stops reporting must not leave its boxes on the picture.
      if (state !== "ready") overlay.clearModule(moduleId);
      useRuntimeStore.getState().setModuleStatuses(modules.statuses());
      publishPlugins();
    }),
    bus.on("frame.available", ({ frameId, timestampMs, width, height }) => {
      if (lastFrameId > 0) {
        const delta = timestampMs - lastFrameTimestampMs;
        if (delta > 0) frameIntervalMs = frameIntervalMs * 0.9 + delta * 0.1;
      }
      lastFrameId = frameId;
      lastFrameTimestampMs = timestampMs;
      renderer.setImageAspect(width / height);
    }),
    bus.on("detection.batch", (batch) => {
      overlay.submit(batch, performance.now(), lastFrameId, frameIntervalMs);
      useRuntimeStore.getState().setDiagnostics({ detections: batch.detections.length });
    }),
    bus.on("render.metrics", ({ fps, frameMs, droppedFrames }) => {
      useRuntimeStore.getState().setDiagnostics({ renderFps: fps, frameMs, droppedFrames });
    }),
    // Surfaced in the diagnostics panel: without icons the user needs a written
    // trace of what the hands are doing to learn the gestures.
    bus.on("gesture", (event) => {
      // A snap points at nothing, so it means the same thing everywhere: show
      // the menu, where every control lives. Core recognises it
      // and says so; deciding what it does is this layer's business.
      if (event.type === "snap") useSharedUiStore.getState().toggleMenu();
      useRuntimeStore
        .getState()
        .setLastEvent({ type: event.type, hand: event.hand, targetId: event.targetId ?? null });
    }),
    useLocaleStore.subscribe(() => publishPlugins()),
  ];

  // Ten times a second is fast enough to watch fingers close and slow enough
  // that the panel is readable; and it is only paid for while it is open.
  const PROBE_INTERVAL_MS = 100;
  let lastProbeMs = 0;

  const offTick = renderer.onTick(({ nowMs, deltaMs }) => {
    videoLayer.syncSize();
    interaction.update(nowMs);
    overlay.setState({ hoveredId: interaction.hoveredTargetId, selectedId: interaction.selectedId });
    overlay.update(nowMs, deltaMs);
    if (
      nowMs - lastProbeMs >= PROBE_INTERVAL_MS &&
      useSharedUiStore.getState().diagnosticsOpen
    ) {
      lastProbeMs = nowMs;
      useRuntimeStore.getState().setHandProbes(interaction.probes());
    }
    frameHub.setLoad(renderer.currentFps, document.visibilityState === "visible");
  });
  renderer.start();

  const syncCameraOrientation = (): void => {
    const source = camera.current;
    if (!source) return;
    const video = {
      width: source.video.videoWidth || source.width,
      height: source.video.videoHeight || source.height,
    };
    const mirrored = source.mirrored && settings.render.mirrorFrontCamera;
    renderer.renderScene.videoRoot.rotation.z = 0;
    renderer.mapper.setOrientation({ mirrored, rotationDeg: 0 });
    renderer.setImageAspect(video.width / video.height);
    videoLayer.setOrientation(mirrored, 0);
    videoLayer.syncSize();
    frameHub.setOrientation({ mirrored, rotationDeg: 0 });
  };

  const offLayout = renderer.layout.subscribe(() => syncCameraOrientation());
  const onViewTurn = () => syncCameraOrientation();
  window.addEventListener("orientationchange", onViewTurn);
  window.addEventListener("resize", onViewTurn);

  const startCamera = async (request: CameraRequest = DEFAULT_CAMERA_REQUEST): Promise<void> => {
    const capabilities = await detectCapabilities();
    const blockers = findBlockers(capabilities);
    useRuntimeStore.getState().setCapabilities(capabilities, blockers);
    if (blockers.length > 0) {
      throw new LocalizedError({
        vi: blockers.map((blocker) => blocker.message.vi).join(" "),
        en: blockers.map((blocker) => blocker.message.en).join(" "),
      });
    }

    const source = await camera.start(request);
    const mirrored = source.mirrored && settings.render.mirrorFrontCamera;
    videoLayer.attach(source.video, mirrored, 0);
    videoLayer.mesh.visible = true;
    frameHub.attach(source);
    syncCameraOrientation();
    frameHub.start();

    autoOrientation.setCurrent(useRuntimeStore.getState().viewTurn);
    autoOrientation.setEnabled(settings.view.autoRotate);
  };

  const startHands = async (): Promise<void> => {
    if (!settings.flags.handTracking) return;
    const status = await handTracking.initialize();
    useRuntimeStore.getState().setHandStatus(status);
    if (status === "ready") {
      unregisterHandConsumer = frameHub.registerConsumer(
        handTracking.createConsumer(settings.pipeline.handTrackingFps),
      );
    }
  };

  const stop = (): void => {
    autoOrientation.setEnabled(false);
    unregisterHandConsumer?.();
    unregisterHandConsumer = null;
    void modules.disposeAll();
    frameHub.stop();
    camera.stop();
    videoLayer.detach();
  };

  const revealWorld = (): void => {
    videoLayer.mesh.visible = true;
    renderer.renderScene.overlayRoot.visible = true;
    renderer.renderScene.uiRoot.visible = true;
    renderer.renderScene.cursorRoot.visible = true;
  };

  const applySettings = (next: Settings): void => {
    settings = next;
    renderer.setSettings(next.render, next.lens);
    videoLayer.setBarrel(next.lens.k1, next.lens.k2);
    interaction.setSettings(next.gesture, next.snap, next.flags.snapGesture);
    frameHub.setAnalysisMaxSize(next.pipeline.analysisMaxSize);
    useRuntimeStore.getState().updateSettings(next);
    applyTheme(next.theme);
    renderer.applyTheme();
    overlay.setMaxBatchAge(next.render.maxBatchAgeMs);
    overlay.applyTheme();
    cursors.applyTheme();
    videoLayer.applyTheme();
    media.applyTheme();
    models.syncSettings(next);
    wake.syncSettings();
    if (next.view.autoRotate) {
      autoOrientation.setEnabled(true);
    } else {
      autoOrientation.setEnabled(false);
      autoOrientation.setCurrent(next.view.rotation);
      useRuntimeStore.getState().setViewTurn(next.view.rotation);
    }
    syncCameraOrientation();
  };

  const dispose = (): void => {
    stop();
    wake.dispose();
    models.dispose();
    media.dispose();
    embedHost.remove();
    offTick();
    offLayout();
    window.removeEventListener("orientationchange", onViewTurn);
    window.removeEventListener("resize", onViewTurn);
    for (const unsubscribe of unsubscribes) unsubscribe();
    handTracking.dispose();
    autoOrientation.dispose();
    void deviceAccess.dispose();
    overlay.dispose();
    cursors.dispose();
    surface.dispose();
    videoLayer.dispose();
    renderer.dispose();
    registry.clear();
    bus.clear();
  };

  return {
    bus,
    metrics,
    registry: moduleRegistry,
    modules,
    renderer,
    media,
    mountScreens: (frame) => screens.mountFrame(frame),
    models,
    wake,
    claimDeviceAccess: () => deviceAccess.claimFromUserGesture().then(() => undefined),
    startCamera,
    startHands,
    stop,
    applySettings,
    revealWorld,
    dispose,
  };
};
