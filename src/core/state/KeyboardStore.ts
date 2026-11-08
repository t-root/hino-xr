import { createStore } from "zustand/vanilla";
import { currentLocale } from "./LocaleStore";

/** A box the wearer can type into. */
export type TextTarget = HTMLInputElement | HTMLTextAreaElement;

/** Letters; the signs of the first page; the rest of the signs. */
export type KeyboardLayer = "letters" | "symbols" | "more";
export type KeyboardLang = "vi" | "en";
/** Shift for one letter, or locked on. */
export type KeyboardShift = "off" | "once" | "lock";

type KeyboardState = {
  /** The on-screen keyboard is up. It comes up by itself when a text box is chosen. */
  open: boolean;
  /** The box it types into; null when closed. */
  target: TextTarget | null;
  layer: KeyboardLayer;
  /** `vi` types Telex (aa is a circumflex a, s puts on a tone mark); `en` types the letters as they are. */
  lang: KeyboardLang;
  shift: KeyboardShift;
  /** The microphone key is recording. */
  listening: boolean;
  /** What was said is being turned into text. */
  transcribing: boolean;

  show: (target: TextTarget) => void;
  hide: () => void;
  setLayer: (layer: KeyboardLayer) => void;
  setLang: (lang: KeyboardLang) => void;
  setShift: (shift: KeyboardShift) => void;
  setListening: (listening: boolean) => void;
  setTranscribing: (transcribing: boolean) => void;
};

/**
 * The on-screen keyboard, held once for every eye (rules.md): each eye draws it from here, so a key pressed
 * in one eye shows in both, and nothing about it exists twice.
 */
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
