import { useSharedUiStore } from "@/core/state/SharedUiStore";

/** Two taps closer in time than this are one double tap. */
const DOUBLE_TAP_MS = 400;
/** ...and closer on the screen than this (pixels). */
const DOUBLE_TAP_PX = 60;

type DoubleTapActions = Readonly<{
  /** Stands in for saying "system call". Returns false if the system is not waiting for it. */
  systemCall: () => boolean;
}>;

/**
 * Touching the screen twice starts the system, the same as saying "system call".
 * Only taps made while the system waits to be called count (the tap on Start that
 * opened the camera does not), and once it is up a double tap does nothing.
 * Returns the function that removes the listener.
 */
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
