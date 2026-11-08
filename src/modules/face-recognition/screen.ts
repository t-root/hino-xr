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

/**
 * One copy of the plugin's screen: a card at the foot of the camera frame with who is in front of the camera,
 * what can be done about them, the form to save or edit a person, and the list of everyone saved.
 *
 * Every copy draws from the one state in the module, so both eyes always show the same thing. The form keeps
 * its inputs between redraws (a rebuilt input would lose the cursor and the on-screen keyboard); everything
 * else is rebuilt, because it holds no typing.
 */
export const mountFaceScreen = (element: HTMLElement, face: FaceController): (() => void) => {
  // The box Core gives a plugin screen is half the camera frame, centred: it must not catch presses that
  // are meant for the picture or the menu behind it. Only the card itself does.
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

    // Someone who is known already has their name, year and note beside their face: nothing is said again here.
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
    // Written only when different, so typing in one eye does not move the cursor in the other.
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
            // Editing a person is in the list; here a known face only offers another look at it.
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
