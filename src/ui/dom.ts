/** Tiny DOM helpers. The interface is HTML, not a component tree. */

type Attrs = {
  className?: string;
  text?: string;
  type?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  value?: number | string;
  checked?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  name?: string;
  htmlFor?: string;
  style?: Record<string, string>;
  dataset?: Record<string, string | number | boolean | null | undefined>;
  onClick?: (event: MouseEvent) => void;
  onInput?: (event: Event) => void;
  onChange?: (event: Event) => void;
  onWheel?: (event: WheelEvent) => void;
  onPointerDown?: (event: PointerEvent) => void;
  onPointerMove?: (event: PointerEvent) => void;
  onPointerUp?: (event: PointerEvent) => void;
  onPointerCancel?: (event: PointerEvent) => void;
};

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: ReadonlyArray<Node | string | null | undefined> = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  apply(node, attrs);
  for (const child of children) {
    if (child == null) continue;
    node.append(typeof child === "string" ? child : child);
  }
  return node;
};

export const apply = (node: HTMLElement, attrs: Attrs): void => {
  if (attrs.className !== undefined) node.className = attrs.className;
  if (attrs.text !== undefined) node.textContent = attrs.text;
  if (attrs.type !== undefined) node.setAttribute("type", attrs.type);
  if (attrs.min !== undefined) node.setAttribute("min", String(attrs.min));
  if (attrs.max !== undefined) node.setAttribute("max", String(attrs.max));
  if (attrs.step !== undefined) node.setAttribute("step", String(attrs.step));
  if (attrs.value !== undefined && node instanceof HTMLInputElement) node.value = String(attrs.value);
  if (attrs.checked !== undefined && node instanceof HTMLInputElement) node.checked = attrs.checked;
  if (attrs.disabled !== undefined && "disabled" in node) {
    (node as HTMLButtonElement).disabled = attrs.disabled;
  }
  if (attrs.hidden !== undefined) node.hidden = attrs.hidden;
  if (attrs.name !== undefined) node.setAttribute("name", attrs.name);
  if (attrs.htmlFor !== undefined) node.setAttribute("for", attrs.htmlFor);
  if (attrs.style) {
    for (const [key, value] of Object.entries(attrs.style)) node.style.setProperty(key, value);
  }
  if (attrs.dataset) {
    for (const [key, value] of Object.entries(attrs.dataset)) {
      if (value == null) delete node.dataset[key];
      else node.dataset[key] = String(value);
    }
  }
  if (attrs.onClick) node.addEventListener("click", attrs.onClick);
  if (attrs.onInput) node.addEventListener("input", attrs.onInput);
  if (attrs.onChange) node.addEventListener("change", attrs.onChange);
  if (attrs.onWheel) node.addEventListener("wheel", attrs.onWheel);
  if (attrs.onPointerDown) node.addEventListener("pointerdown", attrs.onPointerDown as EventListener);
  if (attrs.onPointerMove) node.addEventListener("pointermove", attrs.onPointerMove as EventListener);
  if (attrs.onPointerUp) node.addEventListener("pointerup", attrs.onPointerUp as EventListener);
  if (attrs.onPointerCancel) node.addEventListener("pointercancel", attrs.onPointerCancel as EventListener);
};

export const empty = (node: ParentNode): void => {
  node.replaceChildren();
};

type Store<S> = {
  subscribe: (listener: (state: S, prev: S) => void) => () => void;
  getState: () => S;
};

/** Fires when the selected slice changes by reference. */
export const watch = <S>(store: Store<S>, select: (state: S) => unknown, onChange: () => void): (() => void) => {
  let prev = select(store.getState());
  return store.subscribe((state) => {
    const next = select(state);
    if (Object.is(next, prev)) return;
    prev = next;
    onChange();
  });
};
