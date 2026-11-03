import { useRuntimeStore } from "@/core/state/RuntimeStore";
import { el, empty } from "../dom";
import { t } from "../i18n/useText";
import { assistantStateKey, handStateKey, micModeKey } from "@/i18n/text";

/**
 * One short line in the corner: frames per second drawn, delivered by the camera
 * and finished by the hand tracker, and whether the hand is being followed.
 * Frame time, detection counts and the module list are not here; modules are
 * switched and read in the menu's `plugin` entry.
 */
export const paintDiagnosticsSection = (parent: HTMLElement): void => {
  empty(parent);
  const { diagnostics, handStatus, assistant } = useRuntimeStore.getState();
  const tone = handStatus === "failed" ? "accent" : handStatus === "ready" ? "strong" : "dim";

  parent.append(
    el("div", { className: "hud__line", dataset: { tone } }, [
      el("span", { text: `FPS ${diagnostics.renderFps}` }),
      el("span", { text: `FPS CAM ${diagnostics.cameraFps}` }),
      el("span", { text: `FPS HAND ${diagnostics.handFps}` }),
      el("span", { text: t(handStateKey(handStatus)) }),
      el("span", { text: `${t("diagnostics.assistant")} ${t(assistantStateKey(assistant.state))}` }),
      el("span", { text: `MIC ${t(micModeKey(diagnostics.micMode))} ${diagnostics.micLevel}` }),
    ]),
  );
};
