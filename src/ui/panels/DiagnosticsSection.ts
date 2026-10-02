import { useRuntimeStore } from "@/core/state/RuntimeStore";
import { el, empty } from "../dom";
import { loc, t } from "../i18n/useText";
import { handStateKey, pluginStateKey } from "@/i18n/text";

/** Two decimals: the thresholds these are read against are that fine. */
const ratio = (value: number): string => value.toFixed(2);

/**
 * Numbers only. Turning modules on and off belongs to the `plugin` entry, so
 * this one stays a place to read rather than a second set of switches.
 */
export const paintDiagnosticsSection = (parent: HTMLElement): void => {
  empty(parent);
  const diagnostics = useRuntimeStore.getState().diagnostics;
  const statuses = useRuntimeStore.getState().moduleStatuses;
  const handStatus = useRuntimeStore.getState().handStatus;
  const lastEvent = useRuntimeStore.getState().lastEvent;
  const probes = useRuntimeStore.getState().handProbes;

  const gesture = lastEvent
    ? `${lastEvent.type} · ${t(lastEvent.hand === "left" ? "hand.left" : "hand.right")}${
        lastEvent.targetId ? ` · ${lastEvent.targetId}` : ""
      }`
    : t("diagnostics.noGesture");

  const tone = handStatus === "failed" ? "accent" : handStatus === "ready" ? "strong" : "dim";

  parent.append(
    el("div", { className: "metrics" }, [
      el("span", { text: t("diagnostics.render") }),
      el("span", { text: `${diagnostics.renderFps} FPS` }),
      el("span", { text: t("diagnostics.frame") }),
      el("span", { text: `${diagnostics.frameMs.toFixed(1)} ms` }),
      el("span", { text: t("diagnostics.dropped") }),
      el("span", { text: String(diagnostics.droppedFrames) }),
      el("span", { text: t("diagnostics.detections") }),
      el("span", { text: String(diagnostics.detections) }),
    ]),
    el("h3", { text: t("diagnostics.hand") }),
    el("span", { className: "chip", dataset: { tone }, text: t(handStateKey(handStatus)) }),
    el("p", { className: "note", text: t("diagnostics.lastGesture", { event: gesture }) }),
    el("h3", { text: t("diagnostics.pinch") }),
  );

  if (probes.length === 0) parent.append(el("p", { className: "note", text: t("diagnostics.noHand") }));
  for (const probe of probes) {
    parent.append(
      el("p", {
        className: "note",
        text: `${t(probe.hand === "left" ? "hand.left" : "hand.right")} · ${probe.state} · ${t(
          "diagnostics.pinchGap",
          {
            ratio: ratio(probe.pinchRatio),
            closest: ratio(probe.closestRatio),
            enter: ratio(probe.enterRatio),
            exit: ratio(probe.exitRatio),
          },
        )} · ${
          probe.target
            ? t("diagnostics.probeTarget", { target: probe.target })
            : t("diagnostics.probeNothing")
        }`,
      }),
    );
  }

  parent.append(el("h3", { text: t("diagnostics.snap") }));
  if (probes.length === 0) parent.append(el("p", { className: "note", text: t("diagnostics.noHand") }));
  for (const probe of probes) {
    parent.append(
      el("p", {
        className: "note",
        text: `${t(probe.hand === "left" ? "hand.left" : "hand.right")} · ${t("diagnostics.snapGap", {
          state: probe.snapState,
          gap: ratio(probe.thumbMiddleRatio),
          curl: ratio(probe.middleCurlRatio),
        })}`,
      }),
    );
  }

  parent.append(el("h3", { text: t("diagnostics.modules") }));
  if (statuses.length === 0) parent.append(el("p", { className: "note", text: t("diagnostics.noModules") }));
  for (const status of statuses) {
    parent.append(
      el("div", { className: "module-row" }, [
        el("div", {}, [
          el("strong", { text: status.id }),
          el("small", {
            text:
              t(pluginStateKey(status.state)) +
              (status.state === "ready" ? ` · ${status.lastLatencyMs.toFixed(0)} ms` : "") +
              (status.lastError ? ` · ${loc(status.lastError)}` : ""),
          }),
        ]),
      ]),
    );
  }
};
