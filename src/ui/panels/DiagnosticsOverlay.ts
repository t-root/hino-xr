import { useRuntimeStore } from "@/core/state/RuntimeStore";
import { useSharedUiStore } from "@/core/state/SharedUiStore";
import { el, watch } from "../dom";
import { watchLocale } from "../i18n/useText";
import { paintDiagnosticsSection } from "./DiagnosticsSection";

export const DiagnosticsOverlay = (parent: ParentNode): (() => void) => {
  let hud: HTMLElement | null = null;

  const sync = () => {
    const open = useSharedUiStore.getState().diagnosticsOpen;
    if (!open) {
      hud?.remove();
      hud = null;
      return;
    }
    if (!hud) {
      hud = el("aside", { className: "hud" });
      parent.append(hud);
    }
    paintDiagnosticsSection(hud);
  };

  sync();
  const stop = [
    watch(useSharedUiStore, (state) => state.diagnosticsOpen, sync),
    watch(useRuntimeStore, (state) => state.diagnostics, sync),
    watch(useRuntimeStore, (state) => state.handStatus, sync),
    watch(useRuntimeStore, (state) => state.assistant.state, sync),
    watchLocale(sync),
  ];
  return () => {
    for (const unsub of stop) unsub();
    hud?.remove();
  };
};
