import { useSharedUiStore } from "@/core/state/SharedUiStore";
import { dropPointer, holdPointer } from "@/core/input/dispatchHandPointer";
import { toLocalPoint } from "@/core/view/localPoint";
import { clamp } from "@/shared/math/num";
import { el, watch } from "../dom";

type ScrollBoxHandle = {
  readonly root: HTMLElement;
  readonly content: HTMLElement;
  dispose: () => void;
};

const AXIS_LOCK_PX = 8;

const isControl = (target: EventTarget | null): boolean =>
  target instanceof Element && Boolean(target.closest("input, select, textarea, button"));

export const ScrollBox = (
  parent: ParentNode,
  options: { id: string; className?: string },
): ScrollBoxHandle => {
  const id = options.id;
  const drag = {
    current: null as { pointerId: number; y: number; from: number; active: boolean } | null,
  };

  const scrollTo = (next: number) => {
    const hidden = (content.offsetHeight ?? 0) - (viewport.clientHeight ?? 0);
    useSharedUiStore.getState().setScroll(id, clamp(next, 0, Math.max(hidden, 0)));
  };

  const viewport = el("div", {
    className: options.className ? `scroll ${options.className}` : "scroll",
    dataset: { handTarget: true },
    onWheel: (event) => {
      const offset = useSharedUiStore.getState().scroll[id] ?? 0;
      scrollTo(offset + event.deltaY);
    },
    onPointerDown: (event) => {
      if (isControl(event.target)) return;
      const offset = useSharedUiStore.getState().scroll[id] ?? 0;
      drag.current = { pointerId: event.pointerId, y: toLocalPoint(event.currentTarget as HTMLElement, event.clientX, event.clientY).y, from: offset, active: false };
    },
    onPointerMove: (event) => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const travel = toLocalPoint(event.currentTarget as HTMLElement, event.clientX, event.clientY).y - current.y;
      if (!current.active) {
        if (Math.abs(travel) < AXIS_LOCK_PX) return;
        current.active = true;
        holdPointer(event.currentTarget, event.pointerId);
      }
      scrollTo(current.from - travel);
    },
    onPointerUp: (event) => {
      const current = drag.current;
      drag.current = null;
      if (current?.active) dropPointer(event.currentTarget, event.pointerId);
    },
    onPointerCancel: (event) => {
      const current = drag.current;
      drag.current = null;
      if (current?.active) dropPointer(event.currentTarget, event.pointerId);
    },
  });

  const content = el("div", { className: "scroll__content" });
  viewport.append(content);
  parent.append(viewport);

  const applyOffset = () => {
    const offset = useSharedUiStore.getState().scroll[id] ?? 0;
    content.style.transform = `translateY(${-offset}px)`;
  };
  applyOffset();

  const stop = watch(useSharedUiStore, (state) => state.scroll[id] ?? 0, applyOffset);

  return { root: viewport, content, dispose: stop };
};
