/**
 * The same element in every copy of the interface.
 *
 * Each eye's camera frame is filled by the same function from the same state
 * (rules.md), so the copies have the same shape and an element is found in
 * the others by the path of child indices that leads to it from its own frame.
 * State the browser keeps on one element only — hovered, pressed — is written
 * through here, so the eye that was not touched shows it too.
 */
const FRAME = ".camera-frame";

const pathFrom = (frame: Element, element: Element): number[] | null => {
  const path: number[] = [];
  for (let node: Element | null = element; node !== frame; node = node.parentElement) {
    const parent = node?.parentElement;
    if (!node || !parent) return null;
    path.unshift(Array.prototype.indexOf.call(parent.children, node));
  }
  return path;
};

/**
 * `element` and its twins in every other frame. With `withAncestors`, also
 * every element on the way down to them, as `:hover` marks a whole chain.
 */
export const twinsOf = (element: Element, withAncestors = false): Element[] => {
  const frame = element.closest(FRAME);
  const path = frame ? pathFrom(frame, element) : null;
  if (!frame || !path) return [element];
  const found: Element[] = [];
  for (const other of Array.from(element.ownerDocument.querySelectorAll(FRAME))) {
    let node: Element | undefined = other;
    const chain: Element[] = [];
    for (const index of path) {
      node = node?.children[index];
      if (!node) break;
      chain.push(node);
    }
    // A copy whose shape differs here has nothing to mark.
    if (!node) continue;
    if (withAncestors) found.push(...chain);
    else found.push(node);
  }
  return found.length > 0 ? found : [element];
};

/** Moves `attribute` from `previous` to `element` and its twins; returns what now has it. */
export const markTwins = (
  attribute: string,
  previous: readonly Element[],
  element: Element | null,
  withAncestors = false,
): Element[] => {
  for (const node of previous) node.removeAttribute(attribute);
  const next = element ? twinsOf(element, withAncestors) : [];
  for (const node of next) node.setAttribute(attribute, "");
  return next;
};
