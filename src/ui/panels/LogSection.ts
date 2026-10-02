import { clockOf, useLogStore } from "@/core/observability/ConsoleLog";
import { el, empty } from "../dom";
import { t } from "../i18n/useText";

export const paintLogSection = (parent: HTMLElement): void => {
  empty(parent);
  const entries = useLogStore.getState().entries;
  const clear = useLogStore.getState().clear;

  parent.append(
    el("div", { className: "row" }, [
      el("button", {
        className: "chip",
        text: t("log.clear"),
        disabled: entries.length === 0,
        onClick: clear,
      }),
      el("span", { className: "log__count", text: t("log.count", { count: entries.length }) }),
    ]),
  );

  if (entries.length === 0) parent.append(el("p", { className: "note", text: t("log.empty") }));

  for (const entry of [...entries].reverse()) {
    parent.append(
      el("div", { className: "log-row", dataset: { level: entry.level } }, [
        el("small", { text: `${clockOf(entry.atMs)} · ${entry.level}` }),
        el("span", { text: entry.text }),
      ]),
    );
  }
};
