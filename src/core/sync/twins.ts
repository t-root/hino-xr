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
    if (!node) continue;
    if (withAncestors) found.push(...chain);
    else found.push(node);
  }
  return found.length > 0 ? found : [element];
};

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
