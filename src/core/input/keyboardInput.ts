import { useKeyboardStore, type TextTarget } from "../state/KeyboardStore";
import { tailWord, telex } from "./Telex";

/**
 * Typing on the on-screen keyboard, for every text box in the application.
 *
 * Keys go into the box the wearer chose the way a person's typing would: the text changes, the caret moves
 * and the box is told with an `input` event. A widget never knows its box was filled from a keyboard drawn on
 * screen, so every text box, in Core or in a plugin, works with it without being changed.
 */

const TEXT_TYPES = new Set(["text", "search", "url", "email", "tel", "password"]);

export const isTextEntry = (node: EventTarget | null): node is TextTarget => {
  if (node instanceof HTMLTextAreaElement) return !node.readOnly && !node.disabled;
  return (
    node instanceof HTMLInputElement && TEXT_TYPES.has(node.type) && !node.readOnly && !node.disabled
  );
};

/** A box on the interface is typed into from the on-screen keyboard, never the phone's own. */
const FRAME = ".camera-frame";

const inFrame = (node: TextTarget): boolean => node.closest(FRAME) !== null;

/**
 * Brings the keyboard up when a text box in the interface is chosen, by a hand, a finger or a mouse.
 * The phone's own keyboard is kept down (`inputmode="none"`), set before the focus lands so it never flashes.
 * Returns how to take it down.
 */
export const installKeyboardFocus = (doc: Document): (() => void) => {
  const boxOf = (event: Event): TextTarget | null => {
    const node = event.target instanceof Element ? event.target.closest("input, textarea") : null;
    return isTextEntry(node) && inFrame(node) ? node : null;
  };
  const keepNativeDown = (event: Event) => {
    const node = boxOf(event);
    if (node) node.inputMode = "none";
  };
  const onFocus = (event: FocusEvent) => {
    const node = boxOf(event);
    if (node) openKeyboardFor(node);
  };
  // A box that already has the focus gets no `focusin` when it is chosen again, so a box typed into and then put
  // away would never bring the keyboard back. Choosing a box is what brings it up, focus or not.
  const onChosen = (event: Event) => {
    const node = boxOf(event);
    if (node) openKeyboardFor(node);
  };
  doc.addEventListener("pointerdown", keepNativeDown, true);
  doc.addEventListener("focusin", onFocus, true);
  doc.addEventListener("click", onChosen, true);
  return () => {
    doc.removeEventListener("pointerdown", keepNativeDown, true);
    doc.removeEventListener("focusin", onFocus, true);
    doc.removeEventListener("click", onChosen, true);
  };
};

/** Brings the keyboard up for a box, unless it is already up for that very box (its layer and shift are kept). */
export const openKeyboardFor = (node: TextTarget): void => {
  node.inputMode = "none";
  const state = useKeyboardStore.getState();
  if (state.open && state.target === node) return;
  state.show(node);
};

/** Puts the keyboard away and lets go of the box, so the next time it is chosen it is a new choice. */
export const closeKeyboard = (): void => {
  const state = useKeyboardStore.getState();
  state.target?.blur();
  state.hide();
};

const announce = (target: TextTarget, data: string | null, inputType: string): void => {
  target.dispatchEvent(new InputEvent("input", { bubbles: true, data, inputType }));
};

const room = (target: TextTarget, adding: number, replacing: number): boolean =>
  target.maxLength < 0 || target.value.length - replacing + adding <= target.maxLength;

/** Replaces the `before` characters ahead of the caret, and whatever is selected, with `text`. */
const replaceAround = (target: TextTarget, before: number, text: string, inputType = "insertText"): void => {
  const end = target.selectionEnd ?? target.value.length;
  const caret = target.selectionStart ?? end;
  const from = Math.max(0, caret - before);
  if (!room(target, text.length, end - from)) return;
  target.setRangeText(text, from, end, "end");
  announce(target, text, inputType);
};

export const typeText = (text: string): void => {
  const target = useKeyboardStore.getState().target;
  if (target?.isConnected) replaceAround(target, 0, text);
};

/** One printable key, already shifted: a letter, a digit or a sign. */
export const typeKey = (char: string): void => {
  const state = useKeyboardStore.getState();
  const target = state.target;
  if (!target?.isConnected) return;
  const caret = target.selectionStart ?? target.value.length;
  const selected = (target.selectionEnd ?? caret) > caret;
  if (state.lang === "vi" && /^\p{L}$/u.test(char) && !selected) {
    const word = tailWord(target.value.slice(0, caret));
    replaceAround(target, word.length, telex(word, char));
  } else {
    replaceAround(target, 0, char);
  }
  if (state.shift === "once") state.setShift("off");
};

/** The caret one place to the left (-1) or right (1), or the selection collapsed to its edge. */
export const moveCaret = (step: -1 | 1): void => {
  const target = useKeyboardStore.getState().target;
  if (!target?.isConnected) return;
  const end = target.selectionEnd ?? target.value.length;
  const start = target.selectionStart ?? end;
  const to = start !== end ? (step < 0 ? start : end) : Math.min(target.value.length, Math.max(0, start + step));
  target.setSelectionRange(to, to);
  // Nothing was typed, so no `input` event: the keyboard's own line is told where the caret went.
  target.dispatchEvent(new Event(CARET_MOVED));
};

/** Sent on a box when the keyboard moves its caret, so what is drawn of the box follows it. */
export const CARET_MOVED = "vkb-caret";

export const backspace = (): void => {
  const target = useKeyboardStore.getState().target;
  if (!target?.isConnected) return;
  const end = target.selectionEnd ?? target.value.length;
  const caret = target.selectionStart ?? end;
  if (end > caret) {
    target.setRangeText("", caret, end, "end");
  } else if (caret > 0) {
    target.setRangeText("", caret - 1, caret, "end");
  } else {
    return;
  }
  announce(target, null, "deleteContentBackward");
};

/** A new line in a text area; in a one-line box it settles the value and puts the keyboard away. */
export const enter = (): void => {
  const target = useKeyboardStore.getState().target;
  if (!target?.isConnected) return;
  if (target instanceof HTMLTextAreaElement) {
    replaceAround(target, 0, "\n", "insertLineBreak");
    return;
  }
  target.dispatchEvent(new Event("change", { bubbles: true }));
  closeKeyboard();
};

/** Dictated text goes in after a space, unless the caret is at the start or already after one. */
export const typeDictation = (text: string): void => {
  const target = useKeyboardStore.getState().target;
  if (!target?.isConnected || text.trim() === "") return;
  const caret = target.selectionStart ?? target.value.length;
  const before = target.value.slice(0, caret);
  const gap = before === "" || /\s$/.test(before) ? "" : " ";
  replaceAround(target, 0, gap + text.trim());
};
