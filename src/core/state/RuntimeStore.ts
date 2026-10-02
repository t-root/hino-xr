import { createStore } from "zustand/vanilla";
import type { LocalizedText } from "@/shared/contracts/locale";
import type { PluginPaletteItem } from "@/shared/contracts/plugin";
import type { CameraState } from "../events/events";
import type { ModuleStatus } from "../modules/ModuleManager";
import type { HandTrackingStatus } from "../input/HandTrackingService";
import type { HandProbe } from "../input/InteractionManager";
import type { Capabilities, CapabilityBlocker } from "../bootstrap/capabilities";
import { INITIAL_DEVICE_GRANTS, type DeviceGrants } from "../device/features";
import { EMPTY_ASSISTANT, type AssistantSnapshot } from "@/shared/contracts/model";
import { DEFAULT_SETTINGS, persistSettings, type Settings } from "./settings";
import type { Turn } from "../view/orientation";

type DiagnosticsSnapshot = Readonly<{
  renderFps: number;
  frameMs: number;
  droppedFrames: number;
  handInferenceMs: number;
  moduleInferenceMs: Readonly<Record<string, number>>;
  detections: number;
}>;

/**
 * The last gesture, kept as its parts rather than as a sentence.
 *
 * A sentence would have to be written when the gesture happens, which is long
 * before anyone reads it and possibly in a language the interface is no longer
 * in. The parts get put together at render time instead.
 */
type LastGesture = Readonly<{
  type: string;
  hand: "left" | "right";
  targetId: string | null;
}>;

export type RuntimeUiState = {
  cameraState: CameraState;
  cameraError: LocalizedText | null;
  deviceLabel: string | null;
  handStatus: HandTrackingStatus;
  /** Every registered plugin with its current on/off state, ready to list. */
  plugins: readonly PluginPaletteItem[];
  moduleStatuses: readonly ModuleStatus[];
  diagnostics: DiagnosticsSnapshot;
  capabilities: Capabilities | null;
  blockers: readonly CapabilityBlocker[];
  settings: Settings;
  /**
   * Quarter-turn the eyes are drawn at. Distinct from the saved setting so the
   * sensors can follow gravity without writing localStorage on every snap.
   */
  viewTurn: Turn;
  deviceGrants: DeviceGrants;
  lastEvent: LastGesture | null;
  /** Live gesture figures, written only while the diagnostics panel is open. */
  handProbes: readonly HandProbe[];
  assistant: AssistantSnapshot;

  setCameraState: (state: CameraState, error?: LocalizedText | null, deviceLabel?: string) => void;
  setHandStatus: (status: HandTrackingStatus) => void;
  setPlugins: (plugins: readonly PluginPaletteItem[]) => void;
  setModuleStatuses: (statuses: readonly ModuleStatus[]) => void;
  setDiagnostics: (patch: Partial<DiagnosticsSnapshot>) => void;
  setCapabilities: (capabilities: Capabilities, blockers: readonly CapabilityBlocker[]) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setViewTurn: (turn: Turn) => void;
  setDeviceGrants: (grants: DeviceGrants) => void;
  setLastEvent: (gesture: LastGesture) => void;
  setHandProbes: (probes: readonly HandProbe[]) => void;
  setAssistant: (assistant: AssistantSnapshot) => void;
  patchAssistant: (patch: Partial<AssistantSnapshot>) => void;
};

const EMPTY_DIAGNOSTICS: DiagnosticsSnapshot = {
  renderFps: 0,
  frameMs: 0,
  droppedFrames: 0,
  handInferenceMs: 0,
  moduleInferenceMs: {},
  detections: 0,
};

/**
 * UI-facing mirror of runtime state. The render loop never reads from here;
 * the DOM layer does, at its own pace, so rebuilding the menu cannot stall a frame.
 */
export const useRuntimeStore = createStore<RuntimeUiState>((set) => ({
  cameraState: "idle",
  cameraError: null,
  deviceLabel: null,
  handStatus: "idle",
  plugins: [],
  moduleStatuses: [],
  diagnostics: EMPTY_DIAGNOSTICS,
  capabilities: null,
  blockers: [],
  settings: DEFAULT_SETTINGS,
  viewTurn: DEFAULT_SETTINGS.view.rotation,
  deviceGrants: INITIAL_DEVICE_GRANTS,
  lastEvent: null,
  handProbes: [],
  assistant: EMPTY_ASSISTANT,

  setCameraState: (cameraState, error = null, deviceLabel) =>
    set((state) => ({
      cameraState,
      cameraError: error,
      deviceLabel: deviceLabel ?? state.deviceLabel,
    })),
  setHandStatus: (handStatus) => set({ handStatus }),
  setPlugins: (plugins) => set({ plugins }),
  setModuleStatuses: (moduleStatuses) => set({ moduleStatuses }),
  setDiagnostics: (patch) => set((state) => ({ diagnostics: { ...state.diagnostics, ...patch } })),
  setCapabilities: (capabilities, blockers) => set({ capabilities, blockers }),
  updateSettings: (patch) =>
    set((state) => {
      const settings: Settings = { ...state.settings, ...patch };
      persistSettings(settings);
      return { settings };
    }),
  setViewTurn: (viewTurn) => set({ viewTurn }),
  setDeviceGrants: (deviceGrants) => set({ deviceGrants }),
  setLastEvent: (lastEvent) => set({ lastEvent }),
  // Nothing changes while no hand is there, and re-rendering to say so ten
  // times a second is worse than saying nothing.
  setHandProbes: (handProbes) =>
    set((state) =>
      handProbes.length === 0 && state.handProbes.length === 0 ? state : { handProbes },
    ),
  setAssistant: (assistant) => set({ assistant }),
  patchAssistant: (patch) => set((state) => ({ assistant: { ...state.assistant, ...patch } })),
}));
