import { useSharedUiStore } from "@/core/state/SharedUiStore";

const DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_PX = 60;

type DoubleTapActions = Readonly<{
  systemCall: () => boolean;
}>;

export const installDoubleTap = (actions: DoubleTapActions): (() => void) => {
  let last: { t: number; x: number; y: number } | null = null;
  const onDown = (event: PointerEvent): void => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (!useSharedUiStore.getState().armed) {
      last = null;
      return;
    }
    const now = performance.now();
    if (last && now - last.t <= DOUBLE_TAP_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) <= DOUBLE_TAP_PX) {
      last = null;
      actions.systemCall();
      return;
    }
    last = { t: now, x: event.clientX, y: event.clientY };
  };
  window.addEventListener("pointerdown", onDown);
  return () => window.removeEventListener("pointerdown", onDown);
};
