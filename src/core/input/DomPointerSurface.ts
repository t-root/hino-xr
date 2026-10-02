import type { GestureEvent } from "@/shared/contracts/input";
import { clamp01 } from "@/shared/math/num";
import { dispatchHandPointer, type HandPointerType } from "./dispatchHandPointer";
import { markTwins } from "../sync/twins";

/**
 * A surface the hand can press that is not part of the 3D scene.
 *
 * Hit-testing meshes cannot answer for the interface, because the interface is
 * DOM: it is laid out by the browser, it reflows, and half of what it draws has
 * no mesh anywhere. So a surface answers for its own contents instead, and
 * `InteractionManager` treats what comes back exactly like any other target.
 */
export interface PointerSurface {
  /** Id of what is under an image-space point, or null for nothing pressable. */
  hit(point: { x: number; y: number }): string | null;
  /** Whether an id came from this surface. Ids are opaque to everyone else. */
  owns(targetId: string): boolean;
  /** The target the hand is over, or null when it is over nothing. */
  hover(targetId: string | null): void;
  handle(event: GestureEvent): void;
  /** What the target is called, in words, for the diagnostics panel. */
  describe(targetId: string): string | null;
}

const ID_PREFIX = "dom:";

/** What a hand may press. Anything else is scenery and the ray goes past it. */
const ACTIONABLE = "button, input, [data-hand-target]";

/** Ids are handed out per element, so the table needs an occasional sweep. */
const PRUNE_AT = 128;

/**
 * How far off a control the hand may be and still press it, as a share of the
 * camera frame's height.
 *
 * A mouse lands on the pixel it was put on. A hand held up in the air does not:
 * it drifts, the tracker adds its own noise, and the thing being aimed at is
 * seen through a lens a few centimetres from the eye. Meanwhile a checkbox is
 * sixteen pixels across — a mouse target, and hopeless for a fingertip. Without
 * a tolerance the pinch works perfectly and lands on nothing, which reads to the
 * wearer as a gesture that does not work at all.
 *
 * Three per cent of the camera frame is roughly a fingertip on screen. The
 * rings below are searched outwards, so a control directly under the hand
 * always wins over a neighbour caught at the edge of the tolerance.
 */
const TOLERANCE = 0.03;

/** Offsets searched around the hand, in units of the tolerance radius. */
const RINGS: readonly (readonly [number, number])[] = [
  [0, 0],
  ...[0, 60, 120, 180, 240, 300].map(
    (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)] as const,
  ),
  ...[30, 90, 150, 210, 270, 330].map(
    (deg) => [2 * Math.cos((deg * Math.PI) / 180), 2 * Math.sin((deg * Math.PI) / 180)] as const,
  ),
];

/**
 * Makes the interface pressable by hand.
 *
 * The interface is drawn once per eye on `.camera-frame`, and the hand lands
 * at the same fraction of that square (`imageToFrame`). Asking the browser
 * what sits at that fraction of the first `.camera-frame` is therefore the
 * same question the wearer is aiming at. Which copy is asked does not matter:
 * both render from the same shared state (rules.md), so pressing either one
 * has the same effect, and the other redraws in the same commit.
 *
 * Two kinds of press are told apart, because the browser only obliges on one of
 * them. Buttons, the menu band, a scroll region — anything that listens for
 * pointer events — are driven by `dispatchHandPointer`, the same events a mouse
 * would have sent. A range input has no activation a synthetic
 * event can reach, so a pinch on one is turned into a value directly, from
 * where along the track the hand is.
 */
export class DomPointerSurface implements PointerSurface {
  private readonly ids = new WeakMap<Element, string>();
  private readonly elements = new Map<string, Element>();
  private nextId = 1;
  private hovered: Element | null = null;
  private pressed: Element | null = null;
  /** The marks are written on every eye's copy, not only the one asked (rules.md). */
  private hoveredTwins: Element[] = [];
  private pressedTwins: Element[] = [];
  /** Last client point that landed inside `.camera-frame`; used when release is outside. */
  private lastClient: { x: number; y: number } | null = null;

  constructor(
    private readonly doc: Document,
    /**
     * Image space → `0..1` on `.camera-frame` (`CoordinateMapper.imageToFrame`).
     * Mapping through the eye box would miss the square when `frameScale` < 1
     * and when the CSS eye is bled past the GL viewport.
     */
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

  /**
   * The words on the control, so the diagnostics panel can say what the hand is
   * pointing at. An opaque id answers "is anything there" and nothing else, and
   * the question being asked is always "why did that press miss".
   */
  describe(targetId: string): string | null {
    const element = this.elements.get(targetId);
    if (!element) return null;
    const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
    return text.length > 0 ? text.slice(0, 32) : element.tagName.toLowerCase();
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
        // Release must always reach the widget, even when the hand is now
        // outside the frame: otherwise a swipe is left mid-drag and the band
        // never settles on a neighbour.
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

  /** The node still on the page: rebuilding the menu can detach the one we pressed. */
  private liveTarget(rebound: Element | undefined): Element | null {
    if (rebound?.isConnected) return rebound;
    if (this.pressed?.isConnected) return this.pressed;
    return null;
  }

  /** The core method: the hand becomes a pointer event on the live element. */
  private point(
    element: Element,
    type: HandPointerType,
    client: Readonly<{ x: number; y: number }>,
    hand: GestureEvent["hand"],
  ): void {
    dispatchHandPointer(element, type, client, hand);
  }

  /** Drops every mark this surface put on the page. */
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
    // The canvas fills the stage. Depending on stacking it can sit above the
    // interface in the hit-test, even when the wearer can see the button. Walk
    // the stack and take the first control that belongs to the interface.
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

  /**
   * The element this id still refers to, even after the menu has replaced the node.
   *
   * A gesture spans many frames. The menu rebuilds when any store it reads
   * changes, and the node we captured on pinch-start is then a detached ghost:
   * `click()` on it fires, and nothing listening in the live tree hears it.
   */
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

  /**
   * The box the interface is drawn in, or null when there is no interface on
   * screen at all — which is the state the app is in before the camera starts.
   */
  private frameRect(): DOMRect | null {
    const frame = this.doc.querySelector(".camera-frame");
    if (!frame) return null;
    const rect = frame.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  }

  /** Where an image-space point lands on `.camera-frame`. */
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

  /** The menu replaces elements as it rebuilds; the ids of the gone ones go too. */
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

/**
 * Presses a target, following a label to the control it names.
 *
 * A switch is a sixteen-pixel box with a line of text beside it, and the row is
 * marked as the target so the hand has something its own size to aim at. The
 * press then has to reach the checkbox: clicking a label forwards to its control
 * in a browser, but only for the browser's own clicks in some engines, so the
 * control is pressed directly and there is nothing to forward.
 */
const activate = (element: Element): void => {
  const control = element instanceof HTMLLabelElement ? element.control : null;
  const target = (control as HTMLElement | null) ?? (element as HTMLElement);
  // A native `click()` is what the menu's click listener is waiting for. Dispatching
  // only a custom Event would light up our own marks and leave the handler that
  // actually opens the thing uncalled — which is a gesture that "works" and
  // does nothing.
  target.click();
};

const isDisabled = (element: Element): boolean =>
  element.hasAttribute("disabled") || element.getAttribute("aria-disabled") === "true";

/**
 * Puts a slider where the hand is along its track.
 *
 * The value has to be written through the prototype's own setter: some
 * environments wrap `value` on the instance, and assigning straight onto the
 * element then changes what is drawn without firing `input` — the next store
 * sync puts the old value back.
 */
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
