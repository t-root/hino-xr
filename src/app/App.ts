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

  /**
   * The system proper: hands, the assistant, the boot log, the menu. Only runs
   * after the wearer has said "system call"; until then the camera is open and
   * split into two eyes and nothing is written on it.
   */
  const handleSystemCall = async () => {
    const ui = useSharedUiStore.getState();
    ui.setArmed(false);
    ui.setStarting(true);
    try {
      await runtime.startHands();
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
    // From here on the assistant answers to its name.
    void runtime.wake.listenForAssistant();
  };

  /** The fingerprint: open the camera, split it in two, then wait to be called. */
  const handleStart = async () => {
    runtime.models.prepareAudio();
    runtime.renderer.setMode("stereo");
    useSharedUiStore.getState().setArmed(true);
    try {
      const access = runtime.claimDeviceAccess();
      const full = await requestAppFullscreen(app);
      if (!full && document.documentElement) await requestAppFullscreen(document.documentElement);
      await unlockViewOrientation();
      await access;
      await runtime.startCamera();
    } catch {
      runtime.renderer.setMode("mono");
      useSharedUiStore.getState().setArmed(false);
      return;
    }
    try {
      await runtime.wake.listenForSystemCall(() => void handleSystemCall());
    } catch {
      // No microphone to call the system with: start it anyway so the app is not stuck on a bare picture.
      void handleSystemCall();
    }
  };

  const handleSettings = (settings: Settings) => {
    runtime.applySettings(settings);
  };

  /**
   * Everything the system draws in one eye: boot log, figures, plugin screens, menu.
   * Not built at all while the system waits to be called, so nothing of it exists,
   * runs a timer or listens to a store until "system call" has been said.
   */
  const mountInterface = (frame: HTMLElement): (() => void) => {
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
      onAssistantPreview: (text) => {
        void runtime.models.previewVoice(text);
      },
    });
    return () => {
      stopLoad();
      stopHud();
      stopMenu();
      stopScreens();
    };
  };

  const mountEyes = (frame: HTMLElement) => {
    let stopInterface: (() => void) | null = useSharedUiStore.getState().armed ? null : mountInterface(frame);
    const stopWaiting = watch(useSharedUiStore, (state: SharedUiState) => state.armed, () => {
      if (useSharedUiStore.getState().armed || stopInterface) return;
      stopInterface = mountInterface(frame);
    });
    return () => {
      stopWaiting();
      stopInterface?.();
      stopInterface = null;
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
    const armed = useSharedUiStore.getState().armed;
    const running = useRuntimeStore.getState().cameraState === "ready";
    const inSession = starting || armed || running;
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
    watch(useSharedUiStore, (state: SharedUiState) => state.armed, syncShell),
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
