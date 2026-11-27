import { fill, type TextValues } from "@/i18n/text";
import type { Locale } from "@/shared/contracts/locale";
import text from "./text.json";

type TextKey = keyof typeof text;

type Child = Node | string | null | undefined | false;

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

const ICONS = {
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  locateFixed:
    '<line x1="2" x2="5" y1="12" y2="12"/><line x1="19" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="5"/><line x1="12" x2="12" y1="19" y2="22"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3"/>',
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

  bind(update: () => void): void {
    this.updates.add(update);
    update();
  }

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

export const show = (node: HTMLElement, visible: boolean): void => {
  node.dataset.show = String(visible);
};

export type ModalState = Readonly<{ open: boolean; closing: boolean }>;

export const MODAL_CLOSED: ModalState = { open: false, closing: false };

export const MODAL_CLOSE_DELAY_MS = 280;

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
