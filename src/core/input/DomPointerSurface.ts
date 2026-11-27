import type { GestureEvent, TwoHandDomDetail, TwoHandEvent } from "@/shared/contracts/input";
import { clamp01 } from "@/shared/math/num";
import { dispatchHandPointer, type HandPointerType } from "./dispatchHandPointer";
import { markTwins } from "../sync/twins";
import { isTextEntry, openKeyboardFor } from "./keyboardInput";

export interface PointerSurface {
  hit(point: { x: number; y: number }): string | null;
  owns(targetId: string): boolean;
  hover(targetId: string | null): void;
  handle(event: GestureEvent): void;
  twoHand?(step: TwoHandEvent): boolean;
  wheel?(point: { x: number; y: number }, deltaY: number): void;
  describe(targetId: string): string | null;
}

const ID_PREFIX = "dom:";

const ACTIONABLE = "button, input, textarea, [data-hand-target]";

const PRUNE_AT = 128;

const TOLERANCE = 0.03;

const RINGS: readonly (readonly [number, number])[] = [
  [0, 0],
  ...[0, 60, 120, 180, 240, 300].map(
    (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)] as const,
  ),
  ...[30, 90, 150, 210, 270, 330].map(
    (deg) => [2 * Math.cos((deg * Math.PI) / 180), 2 * Math.sin((deg * Math.PI) / 180)] as const,
  ),
];

export class DomPointerSurface implements PointerSurface {
  private readonly ids = new WeakMap<Element, string>();
  private readonly elements = new Map<string, Element>();
  private nextId = 1;
  private hovered: Element | null = null;
  private pressed: Element | null = null;
  private hoveredTwins: Element[] = [];
  private pressedTwins: Element[] = [];
  private lastClient: { x: number; y: number } | null = null;

  constructor(
    private readonly doc: Document,
    private readonly toFrame: (point: { x: number; y: number }) => { x: number; y: number },
  ) {}

  hit(point: { x: number; y: number }): string | null {
    const frame = this.frameRect();
    if (!frame) return null;
    const client = this.clientPoint(point, frame);
    if (!client) return null;

    const radius = frame.height * TOLERANCE;
    for (const [dx, dy] of RINGS) {
      const found = this.actionableAt(client.x + dx * radius, client.y + dy * radius);
      if (found) return this.idFor(found);
    }
    return null;
  }

  owns(targetId: string): boolean {
    return targetId.startsWith(ID_PREFIX);
  }

  hover(targetId: string | null): void {
    const element = targetId ? this.elements.get(targetId) ?? null : null;
    if (element === this.hovered) return;
    this.hoveredTwins = markTwins("data-hand-hover", this.hoveredTwins, element);
    this.hovered = element;
  }

  describe(targetId: string): string | null {
    const element = this.elements.get(targetId);
    if (!element) return null;
    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    return text.length > 0 ? text.slice(0, 32) : element.tagName.toLowerCase();
  }

  twoHand(step: TwoHandEvent): boolean {
    const frame = this.frameRect();
    const client = frame ? this.clientPoint(step.center, frame) : null;
    const left = frame ? this.clientPoint(step.left, frame) : null;
    const right = frame ? this.clientPoint(step.right, frame) : null;
    if (!client || !left || !right) return false;
    const under = this.doc.elementFromPoint(client.x, client.y);
    if (!under) return false;
    const event = new CustomEvent<TwoHandDomDetail>("twohand", {
      bubbles: true,
      cancelable: true,
      composed: true,
      detail: { ...step, client, hands: { left, right } },
    });
    under.dispatchEvent(event);
    return event.defaultPrevented;
  }

  wheel(point: { x: number; y: number }, deltaY: number): void {
    const frame = this.frameRect();
    const client = frame ? this.clientPoint(point, frame) : null;
    if (!client) return;
    const under = this.doc.elementFromPoint(client.x, client.y);
    if (!under) return;
    under.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: client.x,
        clientY: client.y,
        deltaY,
        deltaMode: 0,
      }),
    );
  }

  handle(event: GestureEvent): void {
    const cached = event.targetId ? this.elements.get(event.targetId) : undefined;
    const element =
      event.targetId && event.pointer
        ? this.live(event.targetId, cached, event.pointer.position)
        : cached;
    const frame = this.frameRect();
    const client = frame ? this.clientPoint(event.pointer.position, frame) : null;
    if (client) this.lastClient = client;

    switch (event.type) {
      case "pinchstart":
        if (!element) return;
        this.pressed = element;
        this.pressedTwins = markTwins("data-hand-press", this.pressedTwins, element);
        if (client) {
          if (isRange(element)) scrub(element, client.x);
          else this.point(element, "pointerdown", client, event.hand);
        }
        break;

      case "pinchmove":
      case "dragmove":
        if (!element || !client) return;
        if (isRange(element)) scrub(element, client.x);
        else this.point(element, "pointermove", client, event.hand);
        break;

      case "select":
        if (element && !isRange(element)) activate(element);
        break;

      case "pinchend":
      case "dragend": {
        const target = this.liveTarget(element);
        const at = client ?? this.lastClient;
        if (target && at && !isRange(target)) {
          this.point(target, "pointerup", at, event.hand);
        }
        this.lastClient = null;
        this.release();
        break;
      }

      case "cancel": {
        const target = this.liveTarget(element);
        if (target && !isRange(target)) {
          const at = client ?? this.lastClient ?? { x: 0, y: 0 };
          this.point(target, "pointercancel", at, event.hand);
        }
        this.lastClient = null;
        this.release();
        break;
      }

      default:
        break;
    }
  }

  private liveTarget(rebound: Element | undefined): Element | null {
    if (rebound?.isConnected) return rebound;
    if (this.pressed?.isConnected) return this.pressed;
    return null;
  }

  private point(
    element: Element,
    type: HandPointerType,
    client: Readonly<{ x: number; y: number }>,
    hand: GestureEvent["hand"],
  ): void {
    dispatchHandPointer(element, type, client, hand);
  }

  dispose(): void {
    this.hover(null);
    this.release();
    this.lastClient = null;
    this.elements.clear();
  }

  private release(): void {
    this.pressedTwins = markTwins("data-hand-press", this.pressedTwins, null);
    this.pressed = null;
  }

  private actionableAt(clientX: number, clientY: number): Element | null {
    const stack =
      typeof this.doc.elementsFromPoint === "function"
        ? this.doc.elementsFromPoint(clientX, clientY)
        : [];
    const top = this.doc.elementFromPoint(clientX, clientY);
    const nodes = top && !stack.includes(top) ? [...stack, top] : stack.length > 0 ? stack : top ? [top] : [];
    for (const node of nodes) {
      if (!(node instanceof Element)) continue;
      const found = node.closest(ACTIONABLE);
      if (found && found.isConnected && !isDisabled(found) && found.closest(".camera-frame")) return found;
    }
    return null;
  }

  private live(targetId: string, previous: Element | undefined, point: { x: number; y: number }): Element | undefined {
    if (previous?.isConnected) return previous;
    const rebound = this.hit(point);
    if (!rebound) return undefined;
    const next = this.elements.get(rebound);
    if (!next) return undefined;
    this.ids.set(next, targetId);
    this.elements.set(targetId, next);
    return next;
  }

  private frameRect(): DOMRect | null {
    const frame = this.doc.querySelector(".camera-frame");
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  }

  private clientPoint(
    point: { x: number; y: number },
    rect: DOMRect,
  ): { x: number; y: number } | null {
    const uv = this.toFrame(point);
    return {
      x: rect.left + uv.x * rect.width,
      y: rect.top + uv.y * rect.height,
    };
  }

  private idFor(element: Element): string {
    const existing = this.ids.get(element);
    if (existing) {
      this.elements.set(existing, element);
      return existing;
    }
    const id = `${ID_PREFIX}${this.nextId++}`;
    this.ids.set(element, id);
    this.elements.set(id, element);
    if (this.elements.size > PRUNE_AT) this.prune();
    return id;
  }

  private prune(): void {
    for (const [id, element] of this.elements) {
      if (element !== this.pressed && element !== this.hovered && !element.isConnected) {
        this.elements.delete(id);
      }
    }
  }
}

const isRange = (element: Element): element is HTMLInputElement =>
  element instanceof HTMLInputElement && element.type === "range";

const activate = (element: Element): void => {
  const control = element instanceof HTMLLabelElement ? element.control : null;
  const target = (control as HTMLElement | null) ?? (element as HTMLElement);
  if (isTextEntry(target)) {
    target.focus();
    openKeyboardFor(target);
    return;
  }
  target.click();
};

const isDisabled = (element: Element): boolean =>
  element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";

const scrub = (element: Element, clientX: number): void => {
  if (!isRange(element)) return;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0) return;

  const min = Number(element.min === "" ? 0 : element.min);
  const max = Number(element.max === "" ? 100 : element.max);
  const step = Number(element.step === "" ? 1 : element.step) || 1;
  const raw = min + clamp01((clientX - rect.left) / rect.width) * (max - min);
  const value = Math.min(max, Math.max(min, min + Math.round((raw - min) / step) * step));

  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(element, String(value));
  element.dispatchEvent(new Event("input", { bubbles: true }));
};
