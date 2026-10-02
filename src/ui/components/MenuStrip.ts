import { holdPointer } from "@/core/input/dispatchHandPointer";
import { el } from "../dom";

/** Slot width in px. Handed to the stylesheet as `--slot`, so there is one copy. */
const SLOT_PX = 110;

/** How long the band takes to bring an entry to the middle. */
const SLIDE_MS = 300;

/** Past this much movement the gesture is a swipe, and the tap is swallowed. */
const TAP_SLOP_PX = 6;

/**
 * Slots drawn each side of the centred one.
 *
 * The band shows five slots, so four on each side puts every mount and unmount
 * a slot and a half outside the visible width: entries appear and disappear
 * where nothing can be seen, which is what makes the loop look endless rather
 * than patched.
 */
const WINDOW_HALF = 4;

type MenuStripProps<T extends string> = Readonly<{
  items: readonly T[];
  /** Entries are identifiers; what a person reads is decided by the caller. */
  label: (item: T) => string;
  /** Slot of the centred entry. Unbounded: slot and slot + items.length agree. */
  slot: number;
  /** Live swipe offset in px, held outside the component so both eyes share it. */
  drag: number;
  onDrag: (offset: number) => void;
  /**
   * A swipe has ended: the nearest slot. Drag is always cleared in this same
   * write so the band cannot rest between two entries.
   */
  onSettle: (slot: number, residual: number) => void;
  /** A tap on a slot. Only the middle one is a choice; the rest are a move. */
  onSelect: (slot: number) => void;
}>;

/**
 * How far a swipe is from the nearest slot, as whole steps plus leftover px.
 *
 * Halfway rounds away from zero on both sides: `Math.round(-0.5)` is 0, which
 * would refuse to snap to the previous entry.
 */
const swipeSettle = (offset: number): { readonly steps: number; readonly residual: number } => {
  const raw = -offset / SLOT_PX;
  const steps = raw === 0 ? 0 : Math.sign(raw) * Math.round(Math.abs(raw));
  return { steps, residual: offset + steps * SLOT_PX };
};

/**
 * A band of names that slides horizontally so the selected one sits in the
 * middle of the eye, the rest running off both edges.
 *
 * The band listens for pointer events, nothing else. A hand reaches those
 * events through core (`dispatchHandPointer`); there is no second, hand-only
 * path here.
 */
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
      origin.current = event.clientX;
      swiped.current = false;
      settled.current = false;
      liveOffset.current = 0;
    },
    onPointerMove: (event) => {
      if (origin.current === null) return;
      const offset = event.clientX - origin.current;
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
