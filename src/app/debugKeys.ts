import { useSharedUiStore } from "@/core/state/SharedUiStore";

type DebugKeyActions = Readonly<{
  /** Stands in for saying "system call". Returns false if the system is not waiting for it. */
  systemCall: () => boolean;
}>;

/**
 * Debug-only keyboard stand-ins for things that are otherwise voice or hands:
 * `S` is "system call", `M` is the finger snap that opens (and closes) the menu.
 * Nothing else is bound. Returns the function that removes the listener.
 */
export const installDebugKeys = (actions: DebugKeyActions): (() => void) => {
  const onKey = (event: globalThis.KeyboardEvent): void => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target?.isContentEditable || target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
    const key = event.key.toLowerCase();
    if (key === "s") {
      actions.systemCall();
    } else if (key === "m") {
      const ui = useSharedUiStore.getState();
      // Same as the snap: nothing to open while waiting to be called or booting.
      if (ui.armed || ui.starting) return;
      ui.toggleMenu();
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
};
