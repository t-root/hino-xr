import type { Handedness } from "@/shared/contracts/input";
import { useCursorStore } from "@/core/state/CursorStore";
import { el } from "../dom";

/** A press that landed is shown as a square burst for this long, ms. */
const FLASH_MS = 240;

type Parts = Readonly<{ root: HTMLElement; frame: HTMLElement; pip: HTMLElement; grip: HTMLElement; flash: HTMLElement }>;

const corner = (which: string) => el("i", { className: `cursor__corner cursor__corner--${which}` });

const makeParts = (hand: Handedness): Parts => {
  const frame = el("div", { className: "cursor__frame" }, [corner("tl"), corner("tr"), corner("bl"), corner("br")]);
  const pip = el("div", { className: "cursor__pip" });
  const grip = el("div", { className: "cursor__ring cursor__grip" });
  const flash = el("div", { className: "cursor__ring cursor__flash" });
  const root = el("div", { className: "cursor", dataset: { hand } }, [frame, pip, grip, flash]);
  return { root, frame, pip, grip, flash };
};

const size = (node: HTMLElement, px: number): void => {
  node.style.width = `${px}px`;
  node.style.height = `${px}px`;
};

/**
 * The hand cursors of one eye: four corner brackets, a square pip that fills as a hold runs, a larger square
 * while dragging, and a one-shot burst when a press lands. One colour, nothing looping.
 *
 * It is the topmost thing in the eye, above the interface and every plugin screen, and it takes no presses
 * (rules.md A1). Every eye draws the same frame from `useCursorStore`, so both always agree.
 */
export const CursorOverlay = (): Readonly<{ root: HTMLElement; dispose: () => void }> => {
  const root = el("div", { className: "cursor-layer" });
  const parts = new Map<Handedness, Parts>();
  let height = 0;
  const observer = new ResizeObserver(() => {
    height = root.clientHeight;
  });
  observer.observe(root);

  const paint = () => {
    const { marks, flashes, unit, alpha, nowMs } = useCursorStore.getState();
    const half = unit * (height || root.clientHeight);
    const seen = new Set<Handedness>();

    for (const mark of marks) {
      seen.add(mark.hand);
      let part = parts.get(mark.hand);
      if (!part) {
        part = makeParts(mark.hand);
        parts.set(mark.hand, part);
        root.append(part.root);
      }
      const held = mark.phase === "pinching" || mark.phase === "dragging";
      const frameScale = held ? 0.72 : mark.phase === "hover" ? 1.18 : 1;
      part.root.hidden = false;
      part.root.style.left = `${mark.x * 100}%`;
      part.root.style.top = `${mark.y * 100}%`;
      part.root.style.setProperty("--thick", `${Math.max(1.5, half * 0.07)}px`);

      size(part.frame, half * 2 * frameScale);
      part.frame.style.opacity = String(((held ? 0.7 : 0.38) + mark.confidence * 0.4) * alpha);

      size(part.pip, half * 2 * (0.1 + mark.progress * 0.28));
      part.pip.style.opacity = String((held ? 0.95 : 0.55) * alpha);

      size(part.grip, half * 2 * 1.45);
      part.grip.style.opacity = String(0.5 * alpha);
      part.grip.hidden = mark.phase !== "dragging";

      const started = flashes[mark.hand] ?? 0;
      const elapsed = nowMs - started;
      const running = started > 0 && elapsed >= 0 && elapsed < FLASH_MS;
      part.flash.hidden = !running;
      if (running) {
        const t = elapsed / FLASH_MS;
        size(part.flash, half * 2 * (1 + t * 1.35));
        part.flash.style.opacity = String((1 - t) * 0.85 * alpha);
      }
    }

    for (const [hand, part] of parts) if (!seen.has(hand)) part.root.hidden = true;
  };

  paint();
  const stop = useCursorStore.subscribe(paint);
  return {
    root,
    dispose: () => {
      stop();
      observer.disconnect();
      root.remove();
    },
  };
};
