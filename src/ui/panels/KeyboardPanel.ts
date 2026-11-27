import layouts from "@/shared/keyboard.json";
import { Dictation } from "@/core/input/Dictation";
import { backspace, CARET_MOVED, closeKeyboard, enter, moveCaret, typeKey, typeText } from "@/core/input/keyboardInput";
import { useKeyboardStore } from "@/core/state/KeyboardStore";
import { icon, type IconName } from "../icons";
import { el, watch } from "../dom";
import { t, watchLocale } from "../i18n/useText";

type Kind = "key" | "wide" | "space" | "action";

const NEXT_SHIFT = { off: "once", once: "lock", lock: "off" } as const;

const BEFORE_CARET = 36;
const AFTER_CARET = 16;

export const KeyboardPanel = (parent: ParentNode, dictation: Dictation): (() => void) => {
  let root: HTMLElement | null = null;
  let preview: HTMLElement | null = null;
  let watched: HTMLElement | null = null;

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
