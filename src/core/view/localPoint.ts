import { isTurn, type Turn } from "./orientation";

export const turnOf = (element: Element): Turn => {
  const raw = Number(element.closest(".eye__turn")?.getAttribute("data-turn"));
  return isTurn(raw) ? raw : 0;
};

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

export const toLocalPoint = (element: HTMLElement, clientX: number, clientY: number): { x: number; y: number } => {
  const rect = element.getBoundingClientRect();
  const local = toLocalDelta(element, clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2));
  return { x: element.offsetWidth / 2 + local.x, y: element.offsetHeight / 2 + local.y };
};
