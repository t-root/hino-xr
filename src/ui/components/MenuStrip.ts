import { holdPointer } from "@/core/input/dispatchHandPointer";
import { toLocalPoint } from "@/core/view/localPoint";
import { el } from "../dom";

export const SLOT_PX = 110;

const SLIDE_MS = 300;

const TAP_SLOP_PX = 6;

const WINDOW_HALF = 4;

type MenuStripProps<T extends string> = Readonly<{
  items: readonly T[];
  label: (item: T) => string;
  slot: number;
  drag: number;
  onDrag: (offset: number) => void;
  onSettle: (slot: number, residual: number) => void;
  onSelect: (slot: number) => void;
}>;

const swipeSettle = (offset: number): { readonly steps: number; readonly residual: number } => {
  const raw = -offset / SLOT_PX;
  const steps = raw === 0 ? 0 : Math.sign(raw) * Math.round(Math.abs(raw));
  return { steps, residual: offset + steps * SLOT_PX };
};

export const MenuStrip = <T extends string>(parent: ParentNode, props: MenuStripProps<T>): HTMLElement => {
  const origin = { current: null as number | null };
  const swiped = { current: false };
  const settled = { current: false };
  const liveOffset = { current: 0 };
  let slot = props.slot;
  let drag = props.drag;
  let onDrag = props.onDrag;
  let onSettle = props.onSettle;
  let onSelect = props.onSelect;
  let label = props.label;
  const items = props.items;

  const snapToNearest = (offset: number) => {
    if (settled.current) return;
    settled.current = true;
    origin.current = null;
    const { steps } = swipeSettle(offset);
    onSettle(slot + steps, 0);
  };

  const strip = el("nav", {
    className: "strip",
    style: { "--slot": `${SLOT_PX}px` },
    dataset: { dragging: drag !== 0, handTarget: true },
    onPointerDown: (event) => {
      origin.current = toLocalPoint(event.currentTarget as HTMLElement, event.clientX, event.clientY).x;
      swiped.current = false;
      settled.current = false;
      liveOffset.current = 0;
    },
    onPointerMove: (event) => {
      if (origin.current === null) return;
      const offset = toLocalPoint(event.currentTarget as HTMLElement, event.clientX, event.clientY).x - origin.current;
      if (!swiped.current) {
        if (Math.abs(offset) <= TAP_SLOP_PX) return;
        swiped.current = true;
        holdPointer(event.currentTarget, event.pointerId);
      }
      liveOffset.current = offset;
      onDrag(offset);
    },
    onPointerUp: () => {
      origin.current = null;
      const offset = swiped.current ? liveOffset.current : drag;
      if (!swiped.current && drag === 0) return;
      snapToNearest(offset);
    },
    onPointerCancel: () => {
      origin.current = null;
      if (swiped.current || drag !== 0) snapToNearest(swiped.current ? liveOffset.current : drag);
      else onDrag(0);
    },
  });

  const track = el("div", { className: "strip__track" });
  strip.append(track);
  parent.append(strip);

  const paint = () => {
    const shift = drag - (slot + 0.5) * SLOT_PX;
    strip.dataset.dragging = String(drag !== 0);
    track.style.transform = `translateX(${shift}px)`;
    track.style.transitionDuration = drag === 0 ? `${SLIDE_MS}ms` : "0ms";
    track.replaceChildren();
    for (let offset = -WINDOW_HALF; offset <= WINDOW_HALF; offset += 1) {
      const current = slot + offset;
      const distance = Math.abs(current - slot);
      const index = ((current % items.length) + items.length) % items.length;
      const item = items[index] as T;
      track.append(
        el("button", {
          className: "strip__item",
          text: label(item),
          style: { left: `${current * SLOT_PX}px` },
          dataset: { active: current === slot, distance: Math.min(distance, 3) },
          onClick: () => {
            if (swiped.current) {
              swiped.current = false;
              return;
            }
            onSelect(current);
          },
        }),
      );
    }
  };

  paint();

  (strip as HTMLElement & { update: (next: MenuStripProps<T>) => void }).update = (next) => {
    slot = next.slot;
    drag = next.drag;
    onDrag = next.onDrag;
    onSettle = next.onSettle;
    onSelect = next.onSelect;
    label = next.label;
    paint();
  };

  return strip;
};

export const updateMenuStrip = <T extends string>(root: HTMLElement, next: MenuStripProps<T>): void => {
  (root as HTMLElement & { update: (props: MenuStripProps<T>) => void }).update(next);
};
