import { createStore } from "zustand/vanilla";
import { isLocale, type Locale } from "@/shared/contracts/locale";

const STORAGE_KEY = "vr.locale";

const detect = (): Locale => "vi";

const restore = (): Locale => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
  }
  return detect();
};

const remember = (locale: Locale): void => {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
  }
  if (typeof document !== "undefined") document.documentElement.lang = locale;
};

type LocaleState = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
};

export const useLocaleStore = createStore<LocaleState>((set) => ({
  locale: restore(),
  setLocale: (locale) => {
    remember(locale);
    set({ locale });
  },
}));

export const currentLocale = (): Locale => useLocaleStore.getState().locale;
