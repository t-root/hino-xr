import type { Handedness } from "@/shared/contracts/input";

const HAND_POINTER_ID: Readonly<Record<Handedness, number>> = {
  left: 91,
  right: 92,
};

export type HandPointerType = "pointerdown" | "pointermove" | "pointerup" | "pointercancel";

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
    }
  }
  element.dispatchEvent(new MouseEvent(type, init));
};

export const isHandPointerId = (pointerId: number): boolean =>
  pointerId === HAND_POINTER_ID.left || pointerId === HAND_POINTER_ID.right;

export const holdPointer = (node: EventTarget | null, pointerId: number): void => {
  if (!(node instanceof HTMLElement) || isHandPointerId(pointerId)) return;
  try {
    node.setPointerCapture(pointerId);
  } catch {
  }
};

export const dropPointer = (node: EventTarget | null, pointerId: number): void => {
  if (!(node instanceof HTMLElement) || isHandPointerId(pointerId)) return;
  try {
    if (node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId);
  } catch {
  }
};
