import { isTurn, type Turn } from "./orientation";

/**
 * Pointer coordinates in the element's OWN axes, whatever quarter-turn the interface is drawn at.
 *
 * The interface sits inside `.eye__turn`, which CSS turns by 0, 90, 180 or 270 degrees to follow how the phone is
 * held. Pointer events (a mouse, a finger, a hand) come in screen coordinates, and a widget that reads
 * `clientX - rect.left` or `clientX - startX` then measures along the screen's axes while its own picture is turned:
 * a pinch on a map or a 3D view lands a quarter-turn away, and a drag moves it sideways. A widget that maps a
 * pointer onto its own content must go through these two, not read the screen coordinates itself.
 */

/** The quarter-turn the interface the element is drawn in is at right now. */
export const turnOf = (element: Element): Turn => {
  const raw = Number(element.closest(".eye__turn")?.getAttribute("data-turn"));
  return isTurn(raw) ? raw : 0;
};

/** A screen-space vector as the element's own axes see it (CSS turns clockwise, so this turns it back). */
export const toLocalDelta = (element: Element, dx: number, dy: number): { x: number; y: number } => {
  switch (turnOf(element)) {
    case 90:
      return { x: dy, y: -dx };
    case 180:
      return { x: -dx, y: -dy };
    case 270:
      return { x: -dy, y: dx };
    default:
      return { x: dx, y: dy };
  }
};

/** A screen point as pixels from the element's own top-left corner, in its own (unturned) axes. */
export const toLocalPoint = (element: HTMLElement, clientX: number, clientY: number): { x: number; y: number } => {
  const rect = element.getBoundingClientRect();
  const local = toLocalDelta(element, clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2));
  return { x: element.offsetWidth / 2 + local.x, y: element.offsetHeight / 2 + local.y };
};
