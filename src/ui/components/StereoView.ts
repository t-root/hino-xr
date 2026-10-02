import type { CoordinateMapper } from "@/core/rendering/CoordinateMapper";
import type { StereoLayout, StereoState } from "@/core/rendering/StereoLayout";
import { useRuntimeStore } from "@/core/state/RuntimeStore";
import { markTwins } from "@/core/sync";
import { el, empty } from "../dom";

const IDLE: StereoState = { eyes: [], mode: "mono", requestedMode: "mono", monoReasons: [] };

export const stereoState = (layout: StereoLayout | null): StereoState => layout?.state ?? IDLE;

type StereoViewHandle = {
  dispose: () => void;
};

/**
 * The only parent a session widget may receive (rules.md).
 *
 * `.eye` is the black GL viewport. It is not a mount point. Anything drawn
 * during a session — boot hologram, veil, menu, diagnostics, and whatever
 * is written later — goes into `.camera-frame`.
 */
type StereoMount = (frame: HTMLElement) => () => void;

/**
 * Renders the interface once per eye (rules.md).
 *
 * The eye is the black stage. `mount` receives only `.camera-frame`, so
 * widgets resize and clip with the square Core names. Both copies are
 * filled by the same function reading the same stores, so they show the
 * same markup by construction. Both stay interactive.
 */
/** Grows the CSS eye past the GL viewport so a 1px raster gap cannot leak. */
const EYE_BLEED = 3;

const eyeBox = (eye: { x: number; y: number; width: number; height: number }): Record<string, string> => ({
  left: `${eye.x - EYE_BLEED}px`,
  top: `${eye.y - EYE_BLEED}px`,
  width: `${eye.width + EYE_BLEED * 2}px`,
  height: `${eye.height + EYE_BLEED * 2}px`,
});

const placeFrame = (
  node: HTMLElement,
  mapper: CoordinateMapper,
  eye: { width: number; height: number },
): void => {
  const box = mapper.framePx(eye);
  Object.assign(node.style, {
    left: `${Number.parseInt(box.left, 10) + EYE_BLEED}px`,
    top: `${Number.parseInt(box.top, 10) + EYE_BLEED}px`,
    width: box.width,
    height: box.height,
  });
};

export const StereoView = (
  parent: ParentNode,
  options: {
    layout: StereoLayout | null;
    mapper: CoordinateMapper;
    mount: StereoMount;
  },
): StereoViewHandle => {
  const host = el("div", { className: "stereo-dom" });
  parent.append(host);

  // A mouse hovers one copy only, and `:hover` lives on that element alone.
  // The same chain is marked in every other eye so both light up (rules.md).
  let mouseTwins: Element[] = [];
  const onPointerOver = (event: PointerEvent) => {
    if (event.pointerType !== "mouse" || !(event.target instanceof Element)) return;
    mouseTwins = markTwins("data-twin-hover", mouseTwins, event.target, true);
  };
  const onPointerOut = (event: PointerEvent) => {
    const next = event.relatedTarget;
    if (next instanceof Node && host.contains(next)) return;
    mouseTwins = markTwins("data-twin-hover", mouseTwins, null);
  };
  host.addEventListener("pointerover", onPointerOver);
  host.addEventListener("pointerout", onPointerOut);

  const copies: Array<() => void> = [];
  let signature = "";

  const paint = () => {
    const { eyes } = stereoState(options.layout);
    const turn = useRuntimeStore.getState().viewTurn;
    const next = `${eyes.map((eye) => eye.id).join(",")}|${turn}`;
    const boxes = host.querySelectorAll<HTMLElement>(".eye");

    if (next === signature && boxes.length === eyes.length) {
      eyes.forEach((eye, index) => {
        const box = boxes[index];
        if (!box) return;
        Object.assign(box.style, eyeBox(eye));
        const frame = box.querySelector<HTMLElement>(".camera-frame");
        if (frame) placeFrame(frame, options.mapper, eye);
      });
      return;
    }

    signature = next;
    for (const stop of copies) stop();
    copies.length = 0;
    empty(host);

    eyes.forEach((eye, index) => {
      const box = el("div", {
        className: "eye",
        dataset: { eye: eye.id },
        style: eyeBox(eye),
      });
      if (index > 0) box.setAttribute("aria-hidden", "true");
      const turnBox = el("div", { className: "eye__turn", dataset: { turn } });
      const frame = el("div", { className: "camera-frame" });
      placeFrame(frame, options.mapper, eye);
      turnBox.append(frame);
      box.append(turnBox);
      host.append(box);
      copies.push(options.mount(frame));
    });
  };

  paint();
  const stopLayout = options.layout?.subscribe(paint) ?? (() => {});
  const stopMapper = options.mapper.subscribe(paint);
  const stopTurn = useRuntimeStore.subscribe((state, prev) => {
    if (state.viewTurn !== prev.viewTurn) paint();
  });

  return {
    dispose: () => {
      stopLayout();
      stopMapper();
      stopTurn();
      host.removeEventListener("pointerover", onPointerOver);
      host.removeEventListener("pointerout", onPointerOut);
      for (const stop of copies) stop();
      host.remove();
    },
  };
};
