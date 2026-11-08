import { a, c } from "./palette";

/**
 * The original stylesheet (`index.css` plus every component's emotion styles),
 * scoped under `.map3d` so none of it reaches the rest of the interface.
 *
 * Built as a string because each colour is computed: see `palette.ts`. The
 * numbers are the original's, untouched.
 */
export const map3dCss = (): string => `
.map3d,
.map3d * {
  box-sizing: content-box;
  font-family: "ct-squarefont-vn", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}

.map3d {
  position: absolute;
  inset: 0;
  height: 100%;
  width: 100%;
  margin: 0;
  -webkit-user-select: none;
  user-select: none;
  overflow: hidden;
  color: var(--text);
}

.map3d button:disabled { opacity: 1; }

.map3d button {
  font-size: 13.3333px;
  line-height: normal;
  letter-spacing: normal;
}

.map3d .m3-icon {
  width: 14px;
  height: 14px;
  flex: none;
  vertical-align: middle;
}

/* ---- FullscreenModal ---- */
.map3d .m3-fullscreen {
  width: 100%;
  height: 100%;
  position: absolute;
  inset: 0;
  z-index: 999;
  background-color: transparent;
  display: flex;
}
.map3d .m3-fullscreen[hidden] { display: none; }
.map3d .m3-fullscreen__inner {
  padding: 0;
  height: 100%;
  width: 100%;
  color: var(--text);
}

/* ---- Buttons: the interface's own chip look, square and see-through ---- */
.map3d .m3-next,
.map3d .m3-prev,
.map3d .m3-button,
.map3d .m3-close,
.map3d .m3-locate {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  color: var(--text-dim);
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: 0;
  font-weight: 400;
  font-size: 13px;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: none;
}
/* The buttons are one row along the top, off the edge and clear of the map and the city: Close, Back or Next, and the
   locate button. */
.map3d .m3-bar {
  position: absolute;
  z-index: 9999;
  top: 11cqb;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.map3d .m3-button { z-index: 9999; }
.map3d .m3-next:hover, .map3d .m3-next[data-twin-hover],
.map3d .m3-prev:hover, .map3d .m3-prev[data-twin-hover],
.map3d .m3-button:hover, .map3d .m3-button[data-twin-hover],
.map3d .m3-close:hover, .map3d .m3-close[data-twin-hover],
.map3d .m3-locate:hover, .map3d .m3-locate[data-twin-hover] {
  color: var(--text);
  background: var(--surface-strong);
}
.map3d .m3-next:disabled,
.map3d .m3-prev:disabled,
.map3d .m3-button:disabled { opacity: 0.4; cursor: not-allowed; }
/* The 3D view is small: the buttons in the top row are compact chips. */
.map3d[data-step="city"] .m3-close,
.map3d[data-step="city"] .m3-prev,
.map3d[data-step="city"] .m3-next {
  padding: 0.3rem 0.6rem;
  font-size: 11px;
}
.map3d[data-step="city"] .holo-readout { top: 3.4rem; }
.map3d[data-step="city"] .holo-readout-left { left: 0.75rem; }
.map3d[data-step="city"] .holo-readout-right { right: 0.75rem; }
.map3d [data-show="false"] { display: none !important; }

/* Leaving the screen: not in the original, which was the whole page. */

/* ---- Column / Row / Title / Description ---- */
.map3d .m3-column { display: flex; flex-direction: column; gap: 0.5rem; justify-content: unset; height: auto; }
.map3d .m3-row { display: flex; flex-direction: row; gap: 0.5rem; justify-content: unset; overflow: visible; }
.map3d .m3-title {
  margin: 0;
  color: var(--text);
  font-size: 1.125rem;
  font-weight: 400;
  letter-spacing: 0.08em;
}
.map3d .m3-description {
  margin: 0;
  color: var(--text-dim);
  font-size: 1rem;
  font-weight: 400;
}

/* ---- Modal ---- */
@keyframes m3-fade-in-background {
  0% { backdrop-filter: brightness(100%); }
  100% { backdrop-filter: brightness(70%); }
}
@keyframes m3-fade-out-background {
  0% { backdrop-filter: brightness(70%); }
  100% { backdrop-filter: brightness(100%); }
}
@keyframes m3-fade-in {
  0% { transform: translateY(-10px); opacity: 40%; }
  100% { transform: translateY(0px); opacity: 100%; }
}
@keyframes m3-fade-out {
  0% { transform: translateY(0px); opacity: 100%; }
  100% { transform: translateY(-10px); opacity: 0%; }
}
.map3d .m3-modal {
  display: none;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 100%;
  position: absolute;
  top: 0;
  left: 0;
  backdrop-filter: brightness(70%);
  -webkit-backdrop-filter: brightness(70%);
  scrollbar-width: none;
  z-index: 3000;
  transition: 0.1s;
  animation: m3-fade-in-background 0.3s forwards;
}
.map3d .m3-modal[data-open="true"] { display: flex; }
.map3d .m3-modal[data-closing="true"] { animation: m3-fade-out-background 0.3s forwards; }
.map3d .m3-modal__card {
  width: 100%;
  height: auto;
  margin: 2rem;
  padding: 1.6rem 1.6rem;
  background-color: var(--surface-strong);
  border: 1px solid var(--hairline);
  border-radius: 0;
  color: var(--text);
  font-family: "ct-squarefont-vn", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  /* The original scrolled here; a scroll offset lives in one copy only (rules.md). */
  overflow: hidden;
  word-break: break-all;
  animation: m3-fade-in 0.3s forwards;
}
.map3d .m3-modal[data-closing="true"] .m3-modal__card { animation: m3-fade-out 0.3s forwards; }
/* Measured against this screen's own box in each eye, not the browser window. */
@container (min-width: 1000px) { .map3d .m3-modal__card { width: 40cqi; } }
@container (min-width: 1400px) { .map3d .m3-modal__card { width: 30cqi; } }

/* ---- SelectMap ---- */
.map3d .m3-map {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
.map3d .m3-locate { padding: 0.5rem; }
.map3d .m3-locate .m3-icon { width: 18px; height: 18px; }
.map3d .m3-locate:disabled { cursor: wait; }
.map3d .m3-locate[data-busy="true"] { opacity: 0.6; }
.map3d .m3-locate[data-failed="true"] { color: var(--accent-text); border-color: var(--accent-hairline); }
.map3d .m3-map__leaflet { height: 100%; width: 100%; }
.map3d .m3-hint {
  position: absolute;
  z-index: 9999;
  left: 50%;
  bottom: 6cqb;
  transform: translateX(-50%);
  padding: 0.3rem 0.8rem;
  color: var(--text-dim);
  background: var(--surface);
  border: 1px solid var(--hairline);
  font-size: 12px;
  letter-spacing: 0.04em;
  pointer-events: none;
  white-space: nowrap;
}
.map3d .m3-map__leaflet { height: 100%; width: 100%; }

/* ---- index.css ---- */
.map3d .hologram-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: none;
}
.map3d .hologram-stage::before { content: none; }
.map3d .holo-vignette { display: none; }

.map3d .holo-canvas {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  touch-action: none;
}
.map3d .holo-canvas canvas { display: block; width: 100%; height: 100%; }

.map3d .holo-readout {
  position: absolute;
  z-index: 3;
  top: 5.25rem;
  display: grid;
  gap: 0.28rem;
  color: var(--text);
  font-family: "ct-squarefont-vn", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  letter-spacing: 0.12em;
  pointer-events: none;
}

.map3d .holo-readout::before {
  content: "";
  position: absolute;
  top: -0.55rem;
  width: 2.8rem;
  height: 1px;
  background: var(--ui-ink);
}

.map3d .holo-readout-left { left: 2.2rem; }
.map3d .holo-readout-right { right: 2.2rem; text-align: right; }
.map3d .holo-readout-right::before { right: 0; }

.map3d .holo-readout span { font-size: 0.57rem; opacity: 0.72; }
.map3d .holo-readout strong { font-size: 0.78rem; font-weight: 500; }
.map3d .holo-readout small { font-size: 0.55rem; opacity: 0.75; }

.map3d .holo-label-anchor {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
}
.map3d .holo-label-anchor > * { position: absolute; transform: translate3d(-50%, -50%, 0); }

.map3d .holo-building-label {
  width: max-content;
  min-width: 11rem;
  padding: 0.68rem 0.82rem;
  display: grid;
  gap: 0.28rem;
  border: 1px solid var(--hairline);
  color: var(--text);
  background: var(--surface);
  font-family: "ct-squarefont-vn", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  letter-spacing: 0.08em;
}

.map3d .holo-building-label span,
.map3d .holo-building-label small { font-size: 0.52rem; opacity: 0.8; }
.map3d .holo-building-label strong { font-size: 0.68rem; font-weight: 600; }

.map3d .map-holo-caption {
  position: absolute;
  z-index: 700;
  left: 1rem;
  bottom: 1rem;
  padding: 0.45rem 0.58rem;
  color: var(--text-dim);
  border: 1px solid var(--hairline);
  background: var(--surface);
  font: 0.58rem/1.2 "ct-squarefont-vn", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  letter-spacing: 0.08em;
  pointer-events: none;
}

.map3d .map-credit {
  position: absolute;
  z-index: 700;
  right: 1rem;
  bottom: 1rem;
  color: var(--text-faint);
  font: 0.48rem "ct-squarefont-vn", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  letter-spacing: 0.06em;
  text-decoration: none;
}

.map3d .map-credit:hover, .map3d .map-credit[data-twin-hover] { color: var(--text); }

.map3d .holo-location-marker {
  width: 42px !important;
  height: 42px !important;
  margin: 0 !important;
  border: 0 !important;
  background: transparent !important;
}

.map3d .holo-location-beacon,
.map3d .holo-location-beacon::before,
.map3d .holo-location-beacon::after {
  position: absolute;
  inset: 50%;
  display: block;
  content: "";
  border-radius: 0;
  transform: translate(-50%, -50%);
}

.map3d .holo-location-beacon {
  width: 11px;
  height: 11px;
  background: var(--ui-ink);
}

.map3d .holo-location-beacon::before,
.map3d .holo-location-beacon::after {
  width: 22px;
  height: 22px;
  border: 1px solid var(--ui-ink);
  animation: m3-location-pulse 2.1s ease-out infinite;
}

.map3d .holo-location-beacon::after { animation-delay: 1.05s; }

@keyframes m3-location-pulse {
  from { opacity: 0.9; transform: translate(-50%, -50%) scale(0.35); }
  to { opacity: 0; transform: translate(-50%, -50%) scale(2.1); }
}

.map3d .holo-location-tooltip {
  padding: 0.28rem 0.42rem !important;
  color: var(--text) !important;
  border: 1px solid var(--hairline) !important;
  border-radius: 0 !important;
  background: var(--surface-strong) !important;
  box-shadow: none !important;
  font: 0.55rem "ct-squarefont-vn", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif !important;
  letter-spacing: 0.07em;
}

.map3d .holo-location-tooltip::before { border-top-color: var(--hairline) !important; }

.map3d .hologram-map {
  background: transparent !important;
  box-shadow: none;
}

.map3d .hologram-map .leaflet-tile-pane {
  filter: grayscale(1) invert(1) sepia(1) hue-rotate(132deg) saturate(3.6) brightness(0.56) contrast(1.62);
  opacity: 0.18;
  mix-blend-mode: normal;
}

.map3d .hologram-map .leaflet-overlay-pane { z-index: 650; }

.map3d .hologram-map .leaflet-map-pane,
.map3d .hologram-map .leaflet-tile-container {
  background: transparent !important;
}

.map3d .hologram-map .leaflet-control-attribution {
  color: var(--text-dim);
  background: var(--surface);
}

.map3d .hologram-map .leaflet-control-attribution a {
  color: var(--text);
}

/* The box being drawn: outline and a faint fill, in the theme's colour. */
.map3d .m3-box { stroke: var(--ui-ink); fill: var(--surface-strong); fill-opacity: 1; }

@container (max-width: 640px) {
  .map3d .holo-readout { top: 4.6rem; }
  .map3d .holo-readout-left { left: 1rem; }
  .map3d .holo-readout-right { right: 1rem; }
  .map3d .holo-readout-right span, .map3d .holo-readout-right strong { display: none; }
}
`;
