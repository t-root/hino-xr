import { createStore } from "zustand/vanilla";
import { currentLocale } from "./LocaleStore";

export type TextTarget = HTMLInputElement | HTMLTextAreaElement;

export type KeyboardLayer = "letters" | "symbols" | "more";
export type KeyboardLang = "vi" | "en";
export type KeyboardShift = "off" | "once" | "lock";

type KeyboardState = {
  open: boolean;
  target: TextTarget | null;
  layer: KeyboardLayer;
  lang: KeyboardLang;
  shift: KeyboardShift;
  listening: boolean;
  transcribing: boolean;

  show: (target: TextTarget) => void;
  hide: () => void;
  setLayer: (layer: KeyboardLayer) => void;
  setLang: (lang: KeyboardLang) => void;
  setShift: (shift: KeyboardShift) => void;
  setListening: (listening: boolean) => void;
  setTranscribing: (transcribing: boolean) => void;
};

export const useKeyboardStore = createStore<KeyboardState>((set) => ({
  open: false,
  target: null,
  layer: "letters",
  lang: currentLocale() === "en" ? "en" : "vi",
  shift: "off",
  listening: false,
  transcribing: false,

  show: (target) => set({ open: true, target, layer: "letters", shift: "off" }),
  hide: () => set({ open: false, target: null, listening: false, transcribing: false }),
  setLayer: (layer) => set({ layer }),
  setLang: (lang) => set({ lang }),
  setShift: (shift) => set({ shift }),
  setListening: (listening) => set({ listening }),
  setTranscribing: (transcribing) => set({ transcribing }),
}));
