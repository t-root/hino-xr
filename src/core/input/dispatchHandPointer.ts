import type { Handedness } from "@/shared/contracts/input";

/**
 * The one way a hand presses the interface.
 *
 * Click and drag are recognised once, in the gesture machine. Everything that
 * can be pressed — a button, a slider, the menu band, a scroll region, anything
 * written next year — is then driven with the same pointer events a mouse would
 * have sent. The widget itself never hears about hands. If it works with a
 * mouse, it works with a pinch; if it invents a second path for hands, the two
 * will disagree, which is how the menu band could not be dragged while a slider
 * on the same screen could.
 *
 * `pointerId` is stable per hand so a down, its moves and its up stay one
 * pointer. The numbers sit well above the mouse's `1` and the first touch's `0`.
 */
const HAND_POINTER_ID: Readonly<Record<Handedness, number>> = {
  left: 91,
  right: 92,
};

export type HandPointerType = "pointerdown" | "pointermove" | "pointerup" | "pointercancel";

/**
 * Sends a pointer event at the hand's screen position, bubbling from `element`.
 *
 * Widgets listen for `pointerdown` / `pointermove` / `pointerup` as they would
 * for a mouse. This is the call that makes those listeners fire for a hand.
 */
export const dispatchHandPointer = (
  element: Element,
  type: HandPointerType,
  client: Readonly<{ x: number; y: number }>,
  hand: Handedness,
): void => {
  const held = type === "pointerdown" || type === "pointermove";
  const init: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: client.x,
    clientY: client.y,
    screenX: client.x,
    screenY: client.y,
    pointerId: HAND_POINTER_ID[hand],
    pointerType: "touch",
    isPrimary: true,
    button: 0,
    buttons: held ? 1 : 0,
  };

  const Ctor = element.ownerDocument.defaultView?.PointerEvent;
  if (Ctor) {
    try {
      element.dispatchEvent(new Ctor(type, init));
      return;
    } catch {
      // jsdom's PointerEvent rejects a `view` and some other fields a real
      // browser accepts. The MouseEvent stand-in below is what the menu tests
      // already use, and the menu hears it the same way.
    }
  }
  element.dispatchEvent(new MouseEvent(type, init));
};

const isHandPointerId = (pointerId: number): boolean =>
  pointerId === HAND_POINTER_ID.left || pointerId === HAND_POINTER_ID.right;

/**
 * Capture is for a real mouse or finger that might leave the widget. A hand
 * pointer is dispatched by us and is not in the browser's pointer table, so
 * `setPointerCapture` throws `NotFoundError` and takes the render loop with it.
 */
export const holdPointer = (node: EventTarget | null, pointerId: number): void => {
  if (!(node instanceof HTMLElement) || isHandPointerId(pointerId)) return;
  try {
    node.setPointerCapture(pointerId);
  } catch {
    /* pointer already gone */
  }
};

/** Pair of `holdPointer`. Safe when the pointer was never captured. */
export const dropPointer = (node: EventTarget | null, pointerId: number): void => {
  if (!(node instanceof HTMLElement) || isHandPointerId(pointerId)) return;
  try {
    if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
  } catch {
    /* already released */
  }
};
