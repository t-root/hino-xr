import { createVrRuntime } from "@/core/bootstrap/createVrRuntime";
import { sessionBootReady } from "@/core/bootstrap/sessionBoot";
import { useRuntimeStore, type RuntimeUiState } from "@/core/state/RuntimeStore";
import { useSharedUiStore, type SharedUiState } from "@/core/state/SharedUiStore";
import type { Settings } from "@/core/state/settings";
import { unlockViewOrientation, requestAppFullscreen } from "@/core/view/fullscreen";
import { StereoView, stereoState } from "@/ui/components/StereoView";
import { DiagnosticsOverlay } from "@/ui/panels/DiagnosticsOverlay";
import { LoadingOverlay, bootOutroMs } from "@/ui/panels/LoadingOverlay";
import { SettingsPanel } from "@/ui/panels/SettingsPanel";
import { StartOverlay } from "@/ui/panels/StartOverlay";
import { el, watch } from "@/ui/dom";
import { watchLocale } from "@/ui/i18n/useText";
import "@/ui/styles.css";

const waitForSessionReady = (): Promise<void> =>
  new Promise((resolve) => {
    if (sessionBootReady(useRuntimeStore.getState())) {
      resolve();
      return;
    }
    const stop = useRuntimeStore.subscribe(() => {
      if (!sessionBootReady(useRuntimeStore.getState())) return;
      stop();
      resolve();
    });
  });

export const mountApp = (host: HTMLElement): () => void => {
  const app = el("div", { className: "app" });
  const stage = el("div", { className: "stage" });
  app.append(stage);
  host.append(app);

  const runtime = createVrRuntime(stage);
  let session: { dispose: () => void } | null = null;
  let start: ReturnType<typeof StartOverlay> | null = null;

  const layout = runtime.renderer.layout;

  const handleStart = async () => {
    runtime.models.prepareAudio();
    runtime.renderer.setMode("stereo");
    useSharedUiStore.getState().setStarting(true);
    try {
      const access = runtime.claimDeviceAccess();
      const full = await requestAppFullscreen(app);
      if (!full && document.documentElement) await requestAppFullscreen(document.documentElement);
      await unlockViewOrientation();
      await access;
      await runtime.start();
      if (useRuntimeStore.getState().settings.assistant.enabled) {
        await runtime.models.load();
      }
      runtime.models.onSessionStart();
      await waitForSessionReady();
      runtime.revealWorld();
      useSharedUiStore.getState().setBootOutro(true);
      await new Promise((resolve) => {
        window.setTimeout(resolve, bootOutroMs());
      });
    } catch {
      runtime.renderer.setMode("mono");
    } finally {
      useSharedUiStore.getState().setStarting(false);
    }
  };

  const handleSettings = (settings: Settings) => {
    runtime.applySettings(settings);
  };

  const mountEyes = (frame: HTMLElement) => {
    const { mode, monoReasons } = stereoState(layout);
    const stopLoad = LoadingOverlay(frame);
    const stopHud = DiagnosticsOverlay(frame);
    const stopScreens = runtime.mountScreens(frame);
    const stopMenu = SettingsPanel(frame, {
      stereo: mode === "stereo",
      monoReason: monoReasons[0] ?? null,
      onChange: handleSettings,
      onToggleStereo: () => {
        runtime.renderer.setMode(runtime.renderer.currentMode === "stereo" ? "mono" : "stereo");
      },
      onTogglePlugin: (id) => {
        void runtime.modules.toggle(id);
      },
      onAssistantLoad: (id) => {
        void runtime.models.load(id);
      },
      onAssistantAsk: (prompt) => {
        void runtime.models.ask(prompt);
      },
      onAssistantTalkStart: () => {
        runtime.models.toggleTalk();
      },
    });
    return () => {
      stopLoad();
      stopHud();
      stopMenu();
      stopScreens();
    };
  };

  const showStart = (inSession: boolean) => {
    if (inSession) {
      start?.root.remove();
      start = null;
      if (!session) session = StereoView(app, { layout, mapper: runtime.renderer.mapper, mount: mountEyes });
      return;
    }
    session?.dispose();
    session = null;
    if (!start) start = StartOverlay(app, { onStart: () => void handleStart(), busy: false });
    start.sync(useSharedUiStore.getState().starting);
  };

  const syncShell = () => {
    const starting = useSharedUiStore.getState().starting;
    const running = useRuntimeStore.getState().cameraState === "ready";
    const inSession = starting || running;
    const { mode } = stereoState(layout);
    stage.dataset.mode = mode;
    showStart(inSession);
  };

  syncShell();

  const stop = [
    watch(useRuntimeStore, (state: RuntimeUiState) => state.cameraState, syncShell),
    watch(useRuntimeStore, (state: RuntimeUiState) => state.cameraError, () => start?.sync(useSharedUiStore.getState().starting)),
    watch(useRuntimeStore, (state: RuntimeUiState) => state.blockers, () => start?.sync(useSharedUiStore.getState().starting)),
    watch(useSharedUiStore, (state: SharedUiState) => state.starting, syncShell),
    watchLocale(() => start?.sync(useSharedUiStore.getState().starting)),
    layout.subscribe(() => {
      stage.dataset.mode = stereoState(layout).mode;
    }),
  ];

  return () => {
    for (const unsub of stop) unsub();
    session?.dispose();
    runtime.dispose();
    app.remove();
  };
};
