import layouts from "@/shared/keyboard.json";
import { Dictation } from "@/core/input/Dictation";
import { backspace, CARET_MOVED, closeKeyboard, enter, moveCaret, typeKey, typeText } from "@/core/input/keyboardInput";
import { useKeyboardStore } from "@/core/state/KeyboardStore";
import { icon, type IconName } from "../icons";
import { el, watch } from "../dom";
import { t, watchLocale } from "../i18n/useText";

type Kind = "key" | "wide" | "space" | "action";

const NEXT_SHIFT = { off: "once", once: "lock", lock: "off" } as const;

/** How much of the box is shown above the keys on each side of the caret; the box itself may be hidden behind them. */
const BEFORE_CARET = 36;
const AFTER_CARET = 16;

/**
 * The on-screen keyboard, laid out like a phone's: the number row on top, the letters below it, and a key
 * that turns the letters into signs and back. It comes up by itself when a text box is chosen and goes away
 * when it is done.
 *
 * It is the interface like any other panel, drawn into each eye from the one `KeyboardStore`, and every key
 * is a plain button, so a pinch, a finger or a mouse presses it the way it presses everything else. What a
 * key does is in `keyboardInput`: it types into the box the wearer chose, whichever plugin owns it.
 */
export const KeyboardPanel = (parent: ParentNode, dictation: Dictation): (() => void) => {
  let root: HTMLElement | null = null;
  let preview: HTMLElement | null = null;
  let watched: HTMLElement | null = null;

  /** The box's text with the caret drawn where it really is, so moving it left and right can be seen. */
  const paintPreview = () => {
    if (!preview) return;
    const target = useKeyboardStore.getState().target;
    const text = target?.value ?? "";
    const caret = Math.min(text.length, target?.selectionStart ?? text.length);
    const before = text.slice(Math.max(0, caret - BEFORE_CARET), caret);
    const after = text.slice(caret, caret + AFTER_CARET);
    preview.textContent = `${caret > BEFORE_CARET ? "\u2026" : ""}${before}|${after}${caret + AFTER_CARET < text.length ? "\u2026" : ""}`;
  };

  const key = (label: string, kind: Kind, onClick: () => void, data: Record<string, string | boolean> = {}) =>
    el("button", { className: "vkb__key", text: label, dataset: { kind, ...data }, onClick: () => onClick() });

  /**
   * A key drawn as a picture, with its name kept as the tooltip and the accessible label: a word such as
   * "Xuong dong" is wider than the key it is on and breaks into two lines.
   */
  const iconKey = (
    picture: IconName,
    name: string,
    kind: Kind,
    onClick: () => void,
    data: Record<string, string | boolean> = {},
  ) => {
    const node = el("button", { className: "vkb__key", dataset: { kind, ...data }, onClick: () => onClick() }, [icon(picture)]);
    node.title = name;
    node.setAttribute("aria-label", name);
    return node;
  };

  const rowOf = (...keys: HTMLElement[]) => el("div", { className: "vkb__row" }, keys);

  /** A key that types its own character; letters take their capital while shift is on. */
  const printable = (char: string, shifted: boolean) => {
    const out = shifted ? char.toUpperCase() : char;
    return key(out, "key", () => typeKey(out));
  };

  const build = () => {
    const state = useKeyboardStore.getState();
    const letters = state.layer === "letters";
    const shifted = letters && state.shift !== "off";
    const chars = (row: readonly string[] | undefined) => (row ?? []).map((char) => printable(char, shifted));

    const rows: HTMLElement[] = [rowOf(...chars(layouts.numbers))];
    const erase = iconKey("backspace", t("keyboard.delete"), "wide", () => backspace());
    if (letters) {
      const [top, home, bottomLetters] = layouts.letters;
      const shift = iconKey("shift", t("keyboard.shift"), "wide", () => state.setShift(NEXT_SHIFT[state.shift]), {
        active: state.shift !== "off",
        lock: state.shift === "lock",
      });
      rows.push(rowOf(...chars(top)), rowOf(...chars(home)), rowOf(shift, ...chars(bottomLetters), erase));
    } else if (state.layer === "symbols") {
      const [first, second, third] = layouts.symbols;
      const more = key(t("keyboard.more"), "wide", () => state.setLayer("more"));
      rows.push(rowOf(...chars(first)), rowOf(...chars(second)), rowOf(more, ...chars(third), erase));
    } else {
      const [first] = layouts.more;
      const back = key(t("keyboard.symbols"), "wide", () => state.setLayer("symbols"));
      rows.push(rowOf(...chars(first)), rowOf(back, erase));
    }

    const mic = state.transcribing
      ? iconKey("busy", t("keyboard.busy"), "action", () => void dictation.toggle(), { busy: true })
      : state.listening
        ? iconKey("stop", t("keyboard.stop"), "action", () => void dictation.toggle(), { active: true })
        : iconKey("mic", t("keyboard.mic"), "action", () => void dictation.toggle());
    rows.push(
      rowOf(
        key(letters ? t("keyboard.symbols") : t("keyboard.letters"), "wide", () =>
          state.setLayer(letters ? "symbols" : "letters"),
        ),
        // Which language the keys type in: VI is Telex, EN is the letters as they are.
        key(state.lang === "vi" ? "VI" : "EN", "wide", () => state.setLang(state.lang === "vi" ? "en" : "vi"), {
          active: true,
        }),
        mic,
        printable(",", false),
        iconKey("space", t("keyboard.space"), "space", () => typeText(" ")),
        printable(".", false),
        iconKey("enter", t("keyboard.enter"), "wide", () => enter()),
      ),
    );

    preview = el("span", { className: "vkb__preview" });
    const done = iconKey("check", t("keyboard.done"), "action", () => {
      dictation.cancel();
      closeKeyboard();
    });
    root = el("div", { className: "vkb", dataset: { lang: state.lang, layer: state.layer } }, [
      el("div", { className: "vkb__bar" }, [
        preview,
        iconKey("left", t("keyboard.left"), "action", () => moveCaret(-1)),
        iconKey("right", t("keyboard.right"), "action", () => moveCaret(1)),
        done,
      ]),
      ...rows,
    ]);
    // A mouse press on a key must not take the focus off the box being typed into.
    root.addEventListener("pointerdown", (event) => event.preventDefault());
    paintPreview();
  };

  const follow = (target: HTMLElement | null) => {
    for (const name of ["input", CARET_MOVED]) watched?.removeEventListener(name, paintPreview);
    watched = target;
    for (const name of ["input", CARET_MOVED]) watched?.addEventListener(name, paintPreview);
  };

  const sync = () => {
    const state = useKeyboardStore.getState();
    // The box was removed from the page (the menu was rebuilt): there is nothing left to type into.
    if (state.open && state.target && !state.target.isConnected) {
      state.hide();
      return;
    }
    root?.remove();
    root = null;
    preview = null;
    if (!state.open || !state.target) {
      follow(null);
      return;
    }
    follow(state.target);
    build();
    if (root) parent.append(root);
  };

  // A box that is hidden (a form that was closed) is as good as gone, but nothing tells the keyboard: look now and then.
  const watchTarget = window.setInterval(() => {
    const { open, target } = useKeyboardStore.getState();
    if (open && target && (!target.isConnected || target.offsetParent === null)) {
      dictation.cancel();
      useKeyboardStore.getState().hide();
    }
  }, 500);

  sync();
  const stop = [
    watch(useKeyboardStore, (state) => state, sync),
    watchLocale(sync),
    () => window.clearInterval(watchTarget),
  ];
  return () => {
    for (const unsub of stop) unsub();
    follow(null);
    root?.remove();
  };
};
