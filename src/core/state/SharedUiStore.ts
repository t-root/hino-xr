import { createStore } from "zustand/vanilla";

export const SETTINGS_CATEGORIES = [
  "stereo",
  "orientation",
  "lens",
  "gesture",
  "cursor",
  "colour",
  "plugin",
  "assistant",
  "pipeline",
  "camera",
  "diagnostics",
  "log",
  "language",
] as const;

export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];

const categoryAt = (slot: number): SettingsCategory => {
  const count = SETTINGS_CATEGORIES.length;
  const wrapped = ((slot % count) + count) % count;
  return SETTINGS_CATEGORIES[wrapped] as SettingsCategory;
};

const slotOf = (category: SettingsCategory, from: number): number => {
  const count = SETTINGS_CATEGORIES.length;
  const ahead = ((SETTINGS_CATEGORIES.indexOf(category) - from) % count + count) % count;
  return from + (ahead > count / 2 ? ahead - count : ahead);
};

export type SharedUiState = {
  armed: boolean;
  starting: boolean;
  bootOutro: boolean;
  menuOpen: boolean;
  fillFrame: boolean;
  settingsSlot: number;
  settingsCategory: SettingsCategory;
  settingsDetail: boolean;
  settingsDrag: number;
  diagnosticsOpen: boolean;
  diagnosticsWanted: boolean;
  scroll: Readonly<Record<string, number>>;

  setArmed: (armed: boolean) => void;
  setStarting: (starting: boolean) => void;
  setBootOutro: (outro: boolean) => void;
  setFillFrame: (fill: boolean) => void;
  setMenuOpen: (open: boolean) => void;
  toggleMenu: () => void;
  setSettingsSlot: (slot: number) => void;
  settleSettingsBand: (slot: number, residual: number) => void;
  openSettingsSlot: (slot: number) => void;
  openSettingsCategory: (category: SettingsCategory) => void;
  closeSettingsDetail: () => void;
  setSettingsDrag: (offset: number) => void;
  setDiagnosticsOpen: (open: boolean) => void;
  toggleDiagnostics: () => void;
  setScroll: (key: string, offset: number) => void;
  resetScroll: (key: string) => void;
};

export const MENU_SCROLL_KEY = "menu";

const DEFAULT_CATEGORY: SettingsCategory = "plugin";

const DEFAULT_SLOT = SETTINGS_CATEGORIES.indexOf(DEFAULT_CATEGORY);

const RESET = {
  settingsSlot: DEFAULT_SLOT,
  settingsCategory: DEFAULT_CATEGORY,
  settingsDetail: false,
  settingsDrag: 0,
} as const;

const DIAGNOSTICS_KEY = "hino.diagnosticsOpen";

const savedDiagnostics = (): boolean => {
  try {
    return localStorage.getItem(DIAGNOSTICS_KEY) !== "0";
  } catch {
    return true;
  }
};

const saveDiagnostics = (on: boolean): void => {
  try {
    localStorage.setItem(DIAGNOSTICS_KEY, on ? "1" : "0");
  } catch {
  }
};

export const useSharedUiStore = createStore<SharedUiState>((set) => ({
  armed: false,
  starting: false,
  bootOutro: false,
  menuOpen: false,
  fillFrame: false,
  settingsSlot: DEFAULT_SLOT,
  settingsCategory: DEFAULT_CATEGORY,
  settingsDetail: false,
  settingsDrag: 0,
  diagnosticsOpen: false,
  diagnosticsWanted: savedDiagnostics(),
  scroll: {},

  setArmed: (armed) => set({ armed, ...(armed ? { menuOpen: false, diagnosticsOpen: false } : {}) }),
  setStarting: (starting) =>
    set((state) => ({
      starting,
      bootOutro: false,
      ...(starting ? { menuOpen: false, diagnosticsOpen: false } : { diagnosticsOpen: state.diagnosticsWanted }),
    })),
  setFillFrame: () => set({ fillFrame: false }),
  setBootOutro: (bootOutro) => set((state) => (state.starting || !bootOutro ? { bootOutro } : state)),

  setSettingsSlot: (settingsSlot) =>
    set({ settingsSlot, settingsCategory: categoryAt(settingsSlot) }),
  settleSettingsBand: (settingsSlot, settingsDrag) =>
    set({ settingsSlot, settingsCategory: categoryAt(settingsSlot), settingsDrag }),
  setSettingsDrag: (settingsDrag) => set({ settingsDrag }),

  setDiagnosticsOpen: (diagnosticsOpen) =>
    set((state) => {
      if (state.starting && diagnosticsOpen) return state;
      saveDiagnostics(diagnosticsOpen);
      return { diagnosticsOpen, diagnosticsWanted: diagnosticsOpen };
    }),
  toggleDiagnostics: () =>
    set((state) => {
      if (state.starting) return state;
      saveDiagnostics(!state.diagnosticsOpen);
      return { diagnosticsOpen: !state.diagnosticsOpen, diagnosticsWanted: !state.diagnosticsOpen };
    }),

  setScroll: (key, offset) => set((state) => ({ scroll: { ...state.scroll, [key]: offset } })),
  resetScroll: (key) => set((state) => ({ scroll: { ...state.scroll, [key]: 0 } })),

  openSettingsSlot: (settingsSlot) =>
    set((state) => {
      if (state.starting) return state;
      return {
        settingsSlot,
        settingsCategory: categoryAt(settingsSlot),
        settingsDetail: true,
        settingsDrag: 0,
        scroll: { ...state.scroll, [MENU_SCROLL_KEY]: 0 },
      };
    }),

  openSettingsCategory: (category) =>
    set((state) => {
      if (state.starting) return state;
      return {
        settingsSlot: slotOf(category, state.settingsSlot),
        settingsCategory: category,
        settingsDetail: true,
        settingsDrag: 0,
        scroll: { ...state.scroll, [MENU_SCROLL_KEY]: 0 },
      };
    }),

  closeSettingsDetail: () =>
    set((state) => ({ settingsDetail: false, scroll: { ...state.scroll, [MENU_SCROLL_KEY]: 0 } })),

  setMenuOpen: (menuOpen) =>
    set((state) => {
      if (state.starting && menuOpen) return state;
      return { ...RESET, menuOpen, scroll: { ...state.scroll, [MENU_SCROLL_KEY]: 0 } };
    }),

  toggleMenu: () =>
    set((state) => {
      if (state.starting) return state;
      return {
        ...RESET,
        menuOpen: !state.menuOpen,
        scroll: { ...state.scroll, [MENU_SCROLL_KEY]: 0 },
      };
    }),
}));
