import { createStore } from "zustand/vanilla";

/**
 * Entries of the menu, in the order they appear in the band.
 *
 * The band has no first or last entry: it wraps, so the order here is only the
 * cycle the entries follow, not a line with two ends. `plugin` is where the
 * menu opens; its position in this list carries no other meaning.
 *
 * These are identifiers, not labels. What is printed on the band comes from the
 * message table, so the entry the user is on survives changing the language.
 */
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

/**
 * The entry sitting at a slot of the endless band.
 *
 * Slots run over every integer, negative included: slot 8 with seven entries is
 * the same entry as slot 1, one lap further along. Keeping the slot rather than
 * the entry is what lets the band pass the seam without a jump, because nothing
 * ever has to reset to zero.
 */
const categoryAt = (slot: number): SettingsCategory => {
  const count = SETTINGS_CATEGORIES.length;
  const wrapped = ((slot % count) + count) % count;
  return SETTINGS_CATEGORIES[wrapped] as SettingsCategory;
};

/** The slot for `category` nearest to `from`, so a jump never takes a long lap. */
const slotOf = (category: SettingsCategory, from: number): number => {
  const count = SETTINGS_CATEGORIES.length;
  const ahead = ((SETTINGS_CATEGORIES.indexOf(category) - from) % count + count) % count;
  return from + (ahead > count / 2 ? ahead - count : ahead);
};

export type SharedUiState = {
  starting: boolean;
  /** HUD dissolving over the camera after boot, same in both eyes. */
  bootOutro: boolean;
  /** The one panel of the interface: the menu, centred in each eye. */
  menuOpen: boolean;
  /** Slot of the centred entry on the endless band; grows and shrinks freely. */
  settingsSlot: number;
  /** Always `categoryAt(settingsSlot)`; kept here so readers need no maths. */
  settingsCategory: SettingsCategory;
  /** True while one entry has replaced the band with its own controls. */
  settingsDetail: boolean;
  /** Live swipe offset of the band in px; 0 when it is at rest. */
  settingsDrag: number;
  /** The read-only figures in the corner of each eye; off until asked for. */
  diagnosticsOpen: boolean;
  /**
   * Scroll offset in px of every scrollable region, keyed by a logical id.
   *
   * A native scroll container keeps its position inside the element, which is
   * exactly the kind of state that exists twice in stereo and drifts apart. Any
   * region that scrolls therefore reads its offset from here (rules.md).
   */
  scroll: Readonly<Record<string, number>>;

  setStarting: (starting: boolean) => void;
  setBootOutro: (outro: boolean) => void;
  setMenuOpen: (open: boolean) => void;
  toggleMenu: () => void;
  /** Moves the band without opening anything: swiping browses, it does not choose. */
  setSettingsSlot: (slot: number) => void;
  /**
   * Slot and leftover swipe in one write. Two writes would paint the band back
   * onto the old entry before the new slot arrived, which is the snap that
   * looks stuck.
   */
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

/** Scroll key of the menu's detail screen. */
export const MENU_SCROLL_KEY = "menu";

/** The entry the menu opens on. */
const DEFAULT_CATEGORY: SettingsCategory = "plugin";

/** Opening slot: the lap number is arbitrary, only the entry it lands on matters. */
const DEFAULT_SLOT = SETTINGS_CATEGORIES.indexOf(DEFAULT_CATEGORY);

/** The band always comes back at its opening entry rather than where it was left. */
const RESET = {
  settingsSlot: DEFAULT_SLOT,
  settingsCategory: DEFAULT_CATEGORY,
  settingsDetail: false,
  settingsDrag: 0,
} as const;

/**
 * State that every eye must agree on, down to the pixel (rules.md).
 *
 * In stereo the interface is drawn once per eye from the same stores.
 * Two copies each holding their own flags would only update in the half the
 * pointer happened to be in. Such state lives here instead: one value, read by
 * both copies, so they cannot diverge.
 */
export const useSharedUiStore = createStore<SharedUiState>((set) => ({
  starting: false,
  bootOutro: false,
  menuOpen: false,
  settingsSlot: DEFAULT_SLOT,
  settingsCategory: DEFAULT_CATEGORY,
  settingsDetail: false,
  settingsDrag: 0,
  diagnosticsOpen: false,
  scroll: {},

  setStarting: (starting) =>
    set({ starting, bootOutro: false, ...(starting ? { menuOpen: false, diagnosticsOpen: false } : {}) }),
  setBootOutro: (bootOutro) => set((state) => (state.starting || !bootOutro ? { bootOutro } : state)),

  setSettingsSlot: (settingsSlot) =>
    set({ settingsSlot, settingsCategory: categoryAt(settingsSlot) }),
  settleSettingsBand: (settingsSlot, settingsDrag) =>
    set({ settingsSlot, settingsCategory: categoryAt(settingsSlot), settingsDrag }),
  setSettingsDrag: (settingsDrag) => set({ settingsDrag }),

  setDiagnosticsOpen: (diagnosticsOpen) =>
    set((state) => (state.starting && diagnosticsOpen ? state : { diagnosticsOpen })),
  toggleDiagnostics: () =>
    set((state) => (state.starting ? state : { diagnosticsOpen: !state.diagnosticsOpen })),

  setScroll: (key, offset) => set((state) => ({ scroll: { ...state.scroll, [key]: offset } })),
  resetScroll: (key) => set((state) => ({ scroll: { ...state.scroll, [key]: 0 } })),

  // A screen always arrives at its top, never part-way down where it was left.
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

  // The menu always comes back as the bare band on its opening entry, rather
  // than wherever it was left: it covers the room the wearer is looking at.
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
