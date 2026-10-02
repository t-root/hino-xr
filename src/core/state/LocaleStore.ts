import { createStore } from "zustand/vanilla";
import { isLocale, type Locale } from "@/shared/contracts/locale";

const STORAGE_KEY = "vr.locale";

/**
 * Falls back to the language the browser is already set to, so the first run
 * is in the right language without anybody being asked a question first.
 */
const detect = (): Locale => {
  if (typeof navigator === "undefined") return "vi";
  return navigator.language.toLowerCase().startsWith("vi") ? "vi" : "en";
};

const restore = (): Locale => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Private mode and blocked storage are not reasons to start in the wrong
    // language; the choice simply will not survive a reload.
  }
  return detect();
};

const remember = (locale: Locale): void => {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // See above.
  }
  if (typeof document !== "undefined") document.documentElement.lang = locale;
};

type LocaleState = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
};

/**
 * The language of everything on screen.
 *
 * A store of its own rather than a field of the settings, because it is read
 * from both sides of the app: the interface renders in it, and plugins label
 * their detections in it. One store means both eyes and every module read the
 * same value at the same moment — the same reason the rest of the interface
 * state is shared (rules.md).
 */
export const useLocaleStore = createStore<LocaleState>((set) => ({
  locale: restore(),
  setLocale: (locale) => {
    remember(locale);
    set({ locale });
  },
}));

/** The current language, for code that runs outside the DOM layer. */
export const currentLocale = (): Locale => useLocaleStore.getState().locale;
