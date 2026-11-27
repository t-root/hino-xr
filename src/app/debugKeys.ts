import { useSharedUiStore } from "@/core/state/SharedUiStore";

type DebugKeyActions = Readonly<{
  systemCall: () => boolean;
}>;

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
      if (ui.armed || ui.starting) return;
      ui.toggleMenu();
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
};
