import { useRuntimeStore } from "@/core/state/RuntimeStore";
import { el, empty } from "../dom";
import { micModeKey, TEXT } from "@/i18n/text";

/**
 * One short line in the corner: frames per second drawn, delivered by the camera
 * and finished by the hand tracker, then what the microphone is doing. The box is capped at 60% of the eye, so nothing else fits.
 * Frame time, detection counts and the module list are not here; modules are
 * switched and read in the menu's `plugin` entry.
 */
export const paintDiagnosticsSection = (parent: HTMLElement): void => {
  empty(parent);
  const { diagnostics, handStatus } = useRuntimeStore.getState();
  const tone = handStatus === "failed" ? "accent" : handStatus === "ready" ? "strong" : "dim";

  parent.append(
    el("div", { className: "hud__line", dataset: { tone } }, [
      el("span", { text: `FPS ${diagnostics.renderFps}` }),
      el("span", { text: `FPS CAM ${diagnostics.cameraFps}` }),
      el("span", { text: `FPS HAND ${diagnostics.handFps}` }),
      // English in every language, like the rest of the console-style readout.
      el("span", { text: `MIC ${TEXT[micModeKey(diagnostics.micMode)].en} ${diagnostics.micLevel}` }),
    ]),
  );
};
