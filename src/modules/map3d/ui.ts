import { fill, type TextValues } from "@/i18n/text";
import type { Locale } from "@/shared/contracts/locale";
import text from "./text.json";

type TextKey = keyof typeof text;

type Child = Node | string | null | undefined | false;

/** `document.createElement` with a class and children, nothing more. */
export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  ...children: Child[]
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) if (child) node.append(child);
  return node;
};

/**
 * The lucide icons the original used, at the original 14px. Drawn with
 * `currentColor`, so they take the colour of the button they sit in.
 */
const ICONS = {
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  locateFixed:
    '<line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>',
  circleMinus: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
  mousePointerClick:
    '<path d="M14 4.1 12 6"/><path d="m5.1 8-2.9-.8"/><path d="m6 12-1.9 2"/><path d="M7.2 2.2 8 5.1"/><path d="M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z"/>',
} as const;

type IconName = keyof typeof ICONS;

export const icon = (name: IconName): SVGSVGElement => {
  const template = document.createElement("template");
  template.innerHTML =
    '<svg class="m3-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    `${ICONS[name]}</svg>`;
  return template.content.firstElementChild as SVGSVGElement;
};

/**
 * Every visible word, in the language the interface is in. Whatever reads text
 * registers how to redraw itself, so a language changed while the screen was
 * hidden is picked up when it comes back. Each copy of the screen takes a
 * `scope()` and drops it when it is taken down, so nothing outlives its copy.
 */
export class Words {
  private readonly updates = new Set<() => void>();
  private readonly children = new Set<Words>();

  constructor(
    private readonly locale: () => Locale,
    private readonly parent: Words | null = null,
  ) {
    parent?.children.add(this);
  }

  scope(): Words {
    return new Words(this.locale, this);
  }

  get(key: TextKey, values?: TextValues): string {
    return fill(text[key][this.locale()], values);
  }

  /** Runs `update` now and again on every `refresh`. */
  bind(update: () => void): void {
    this.updates.add(update);
    update();
  }

  /** A text node that follows the language. */
  node(key: TextKey): Text {
    const node = document.createTextNode("");
    this.bind(() => {
      node.data = this.get(key);
    });
    return node;
  }

  refresh(): void {
    for (const update of this.updates) update();
    for (const child of this.children) child.refresh();
  }

  dispose(): void {
    this.parent?.children.delete(this);
    this.updates.clear();
    this.children.clear();
  }
}

/** `isShow` of the original buttons. */
export const show = (node: HTMLElement, visible: boolean): void => {
  node.dataset.show = String(visible);
};

/** Open, and whether the fade out is playing. Shared by every copy. */
export type ModalState = Readonly<{ open: boolean; closing: boolean }>;

export const MODAL_CLOSED: ModalState = { open: false, closing: false };

/** How long the original let the fade out play before hiding, ms. */
export const MODAL_CLOSE_DELAY_MS = 280;

/**
 * One copy of the original modal: a dimmed backdrop and a card that slides in.
 * It only draws `ModalState`; clicking the backdrop asks for the close, which
 * the owner plays on every copy at once.
 */
export class ModalView {
  readonly root: HTMLDivElement;

  constructor(children: readonly Node[], onBackdrop: () => void) {
    const card = h("div", "m3-modal__card", ...children);
    this.root = h("div", "m3-modal", card);
    this.root.addEventListener("click", (event) => {
      if (event.target === this.root) onBackdrop();
    });
  }

  render(state: ModalState): void {
    this.root.dataset.open = String(state.open);
    this.root.dataset.closing = String(state.closing);
  }
}
