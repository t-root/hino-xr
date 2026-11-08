/**
 * The few pictures the interface uses in place of words: line icons drawn in the colour of the text around them
 * (`currentColor`), square-ended like everything else. Used where a word is wider than the key or button it is on.
 */
const PATHS = {
  shift: '<path d="M9 18v-6H5l7-7 7 7h-4v6H9z"/>',
  backspace:
    '<path d="M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/><path d="m12 9 6 6"/><path d="m18 9-6 6"/>',
  enter: '<path d="M20 4v7a4 4 0 0 1-4 4H4"/><path d="m9 10-5 5 5 5"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
  stop: '<rect x="6" y="6" width="12" height="12"/>',
  busy: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  left: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  right: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  space: '<path d="M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1"/>',
} as const;

export type IconName = keyof typeof PATHS;

export const icon = (name: IconName): SVGSVGElement => {
  const template = document.createElement("template");
  template.innerHTML =
    '<svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">' +
    `${PATHS[name]}</svg>`;
  return template.content.firstElementChild as SVGSVGElement;
};
