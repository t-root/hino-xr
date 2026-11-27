import { useRuntimeStore } from "@/core/state/RuntimeStore";
import { el, empty } from "../dom";
import { micModeKey, TEXT } from "@/i18n/text";

export const paintDiagnosticsSection = (parent: HTMLElement): void => {
  empty(parent);
  const { diagnostics, handStatus } = useRuntimeStore.getState();
  const tone = handStatus === "failed" ? "accent" : handStatus === "ready" ? "strong" : "dim";

  parent.append(
    el("div", { className: "hud__line", dataset: { tone } }, [
      el("span", { text: `FPS ${diagnostics.renderFps}` }),
      el("span", { text: `FPS CAM ${diagnostics.cameraFps}` }),
      el("span", { text: `FPS HAND ${diagnostics.handFps}` }),
      el("span", { text: `MIC ${TEXT[micModeKey(diagnostics.micMode)].en} ${diagnostics.micLevel}` }),
    ]),
  );
};
