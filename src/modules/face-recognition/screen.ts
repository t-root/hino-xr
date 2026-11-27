import type { FaceController, ScreenState } from "./FaceRecognitionModule";
import { labelFor } from "./FaceRecognitionModule";
import { faceRecognitionCss } from "./styles";

type Child = Node | string | null | undefined | false;

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", ...children: Child[]): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) if (child) node.append(child);
  return node;
};

const button = (label: string, onClick: () => void, extra = ""): HTMLButtonElement => {
  const node = h("button", `fid-button ${extra}`.trim(), label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
};

export const mountFaceScreen = (element: HTMLElement, face: FaceController): (() => void) => {
  element.style.pointerEvents = "none";

  const style = h("style");
  style.textContent = faceRecognitionCss();

  const status = h("div", "fid-status");
  const actions = h("div", "fid-actions");
  const message = h("div", "fid-message");
  const list = h("div", "fid-list");

  const name = h("input", "fid-input");
  name.type = "text";
  name.maxLength = 80;
  const year = h("input", "fid-input");
  year.type = "text";
  year.maxLength = 4;
  year.inputMode = "numeric";
  const info = h("textarea", "fid-input fid-info");
  info.maxLength = 400;
  info.rows = 1;
  name.addEventListener("input", () => face.setField("name", name.value));
  year.addEventListener("input", () => face.setField("year", year.value.replace(/\D/g, "")));
  info.addEventListener("input", () => face.setField("info", info.value));

  const labels = {
    name: h("span", "fid-label"),
    year: h("span", "fid-label"),
    info: h("span", "fid-label"),
  };
  const form = h(
    "div",
    "fid-form",
    h("label", "fid-field", labels.name, name),
    h("label", "fid-field", labels.year, year),
    h("label", "fid-field", labels.info, info),
    h("div", "fid-actions"),
  );
  const formActions = form.lastElementChild as HTMLElement;

  const card = h("div", "fid-card", status, message, form, list, actions);
  const root = h("div", "face-id", style, card);
  element.append(root);

  const sync = (state: ScreenState): void => {
    const editing = state.mode === "edit";
    const listing = state.mode === "list";

    status.textContent = state.face.kind === "unknown" ? face.say("seeingStranger") : state.face.kind === "none" ? face.say("seeingNobody") : "";
    status.hidden = state.face.kind === "known";
    status.dataset.kind = state.face.kind;

    message.textContent = state.message;
    message.hidden = state.message === "";

    form.hidden = !editing;
    list.hidden = !listing;
    labels.name.textContent = face.say("fieldName");
    labels.year.textContent = face.say("fieldYear");
    labels.info.textContent = face.say("fieldInfo");
    if (name.value !== state.form.name) name.value = state.form.name;
    if (year.value !== state.form.year) year.value = state.form.year;
    if (info.value !== state.form.info) info.value = state.form.info;
    formActions.replaceChildren(
      button(face.say("save"), () => void face.submit(), "fid-primary"),
      button(face.say("cancel"), () => face.close()),
    );
    formActions.querySelectorAll("button").forEach((node) => {
      node.disabled = state.busy;
    });

    list.replaceChildren(
      state.people.length === 0
        ? h("div", "fid-empty", face.say("empty"))
        : h(
            "div",
            "fid-people",
            ...state.people.map((person) =>
              h(
                "div",
                "fid-person",
                h("span", "fid-person-name", labelFor(person)),
                button(face.say("edit"), () => face.beginEdit(person.id)),
                button(face.say("remove"), () => void face.remove(person.id)),
              ),
            ),
          ),
    );

    actions.replaceChildren(
      ...(editing
        ? []
        : [
            ...(state.face.kind === "unknown" ? [button(face.say("saveThis"), () => face.beginAdd(), "fid-primary")] : []),
            ...(state.face.kind === "known" ? [button(face.say("addSample"), () => void face.addSampleToFace())] : []),
            button(listing ? face.say("close") : face.say("people"), () => (listing ? face.close() : face.showList())),
          ]),
    );
  };

  const stop = face.state.subscribe(sync);
  return () => {
    stop();
    root.remove();
  };
};
