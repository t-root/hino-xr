import { createStore } from "zustand/vanilla";
import { isLocale, type Locale } from "@/shared/contracts/locale";

const STORAGE_KEY = "vr.locale";

/**
 * Vietnamese until the wearer picks another language in the menu. The browser's
 * own language is not a guide: a Vietnamese wearer's browser is often English,
 * and then the interface, the speech recogniser and the reply all came out in
 * English with nothing to say why.
 */
const detect = (): Locale => "vi";

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
