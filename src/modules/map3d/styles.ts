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
  font-family: "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, system-ui, Roboto,
    "Helvetica Neue", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", "Apple Color Emoji",
    "Segoe UI Emoji", "Segoe UI Symbol", sans-serif;
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
  color: ${c(0, 0, 0)};
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
  color: ${c(185, 251, 255)};
}

/* ---- BottomButton: NextButton / PrevButton / Button ---- */
.map3d .m3-next,
.map3d .m3-prev {
  position: absolute;
  z-index: 9999;
  bottom: 2rem;
  padding: 0.75rem 1.25rem;
  border-radius: 8px;
  font-weight: 300;
  font-size: 14px;
  cursor: pointer;
  transition: 0.2s;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.map3d .m3-next {
  right: 2rem;
  color: ${c(215, 254, 255)};
  background-color: ${c(3, 93, 119, 0.86)};
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid ${c(101, 241, 255, 0.74)};
  box-shadow: 0 0 20px ${c(43, 225, 247, 0.24)};
  letter-spacing: 0.04em;
}
.map3d .m3-next:hover, .map3d .m3-next[data-twin-hover] { background-color: ${c(8, 136, 166, 0.96)}; }
.map3d .m3-next:disabled { background-color: ${c(8, 54, 68, 0.78)}; cursor: not-allowed; }
.map3d .m3-prev {
  left: 2rem;
  color: ${c(0, 0, 0)};
  background-color: ${c(255, 255, 255, 0.588)};
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: none;
  outline: ${c(240, 240, 244, 0.51)} solid 0.1rem;
}
.map3d .m3-prev:hover, .map3d .m3-prev[data-twin-hover],
.map3d .m3-prev:disabled { background-color: ${c(235, 238, 240, 0.761)}; }
.map3d .m3-prev:disabled { cursor: not-allowed; }
.map3d .m3-button {
  z-index: 9999;
  color: ${c(0, 0, 0)};
  background-color: ${c(255, 255, 255, 0.588)};
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: none;
  padding: 0.75rem 1.25rem;
  border-radius: 8px;
  font-weight: 300;
  font-size: 14px;
  outline: ${c(240, 240, 244, 0.51)} solid 0.1rem;
  cursor: pointer;
  transition: 0.2s;
  gap: 0.5rem;
}
.map3d .m3-button:hover, .map3d .m3-button[data-twin-hover],
.map3d .m3-button:disabled { background-color: ${c(235, 238, 240, 0.761)}; }
.map3d .m3-button:disabled { cursor: not-allowed; }
.map3d [data-show="false"] { display: none !important; }

/* Leaving the screen: not in the original, which was the whole page. */
.map3d .m3-close {
  position: absolute;
  z-index: 9999;
  top: 1rem;
  /* Beside Leaflet's zoom buttons, clear of the tools on the right. */
  left: 3.6rem;
  color: ${c(216, 254, 255)};
  background-color: ${c(2, 37, 53, 0.85)};
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid ${c(83, 239, 255, 0.7)};
  padding: 0.5rem 1rem;
  border-radius: 8px;
  cursor: pointer;
  transition: 0.2s;
}
.map3d .m3-close:hover, .map3d .m3-close[data-twin-hover] { background-color: ${c(10, 77, 97, 0.96)}; }

/* ---- Column / Row / Title / Description ---- */
.map3d .m3-column { display: flex; flex-direction: column; gap: 0.5rem; justify-content: unset; height: auto; }
.map3d .m3-row { display: flex; flex-direction: row; gap: 0.5rem; justify-content: unset; overflow: visible; }
.map3d .m3-title {
  margin: 0;
  color: ${c(186, 250, 255)};
  font-size: 1.125rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-shadow: 0 0 14px ${c(64, 232, 255, 0.52)};
}
.map3d .m3-description {
  margin: 0;
  color: ${c(176, 244, 250, 0.72)};
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
  background-color: ${c(255, 255, 255)};
  border-radius: 0.6rem;
  border: 0.1rem solid ${c(221, 221, 221)};
  box-shadow: ${c(147, 148, 158, 0.25)} 0px 7px 40px;
  font-family: "Noto Sans KR", sans-serif;
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
.map3d .m3-map__tools {
  position: absolute;
  z-index: 9999;
  right: 1rem;
  top: 1rem;
  /* Starts after the close button; wraps rather than covering it when narrow. */
  left: 8.6rem;
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
  pointer-events: none;
}
.map3d .m3-map__tools > * { pointer-events: auto; }
.map3d .m3-locate {
  color: ${c(216, 254, 255)};
  background-color: ${c(2, 37, 53, 0.85)};
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid ${c(83, 239, 255, 0.7)};
  padding: 0.5rem 0.85rem;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.map3d .m3-locate:disabled { cursor: wait; }
.map3d .m3-remove {
  display: flex;
  color: ${c(217, 254, 255)};
  background-color: ${a(105, 29, 47, 0.8)};
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid ${a(255, 101, 132, 0.76)};
  padding: 0.5rem 1rem;
  border-radius: 8px;
  cursor: pointer;
  transition: 0.2s;
  align-items: center;
  gap: 0.5rem;
}
.map3d .m3-remove:hover, .map3d .m3-remove[data-twin-hover] { background-color: ${a(158, 34, 62, 0.92)}; }
.map3d .m3-mode {
  color: ${c(216, 254, 255)};
  background-color: ${c(2, 37, 53, 0.85)};
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid ${c(83, 239, 255, 0.7)};
  padding: 0.5rem 1rem;
  border-radius: 8px;
  cursor: pointer;
  transition: 0.2s;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.map3d .m3-mode:hover, .map3d .m3-mode[data-twin-hover] { background-color: ${c(10, 77, 97, 0.96)}; }
.map3d .m3-mode[data-drag="true"] { background-color: ${c(4, 113, 142, 0.92)}; }
.map3d .m3-mode[data-drag="true"]:hover, .map3d .m3-mode[data-drag="true"][data-twin-hover] { background-color: ${c(8, 146, 180, 0.98)}; }
.map3d .m3-map__leaflet { height: 100%; width: 100%; }

/* ---- index.css ---- */
.map3d .hologram-stage {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 50% 50%, ${c(11, 70, 92, 0.33)}, transparent 45%),
    ${c(2, 9, 19, 0.5)};
}

.map3d .hologram-stage::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  opacity: 0.23;
  background-image:
    linear-gradient(${c(101, 239, 255, 0.11)} 1px, transparent 1px),
    linear-gradient(90deg, ${c(101, 239, 255, 0.11)} 1px, transparent 1px);
  background-size: 54px 54px;
  mask-image: radial-gradient(circle, black 0%, transparent 71%);
  -webkit-mask-image: radial-gradient(circle, black 0%, transparent 71%);
}

.map3d .holo-vignette {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 38%, ${c(0, 4, 12, 0.38)} 100%);
}

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
  color: ${c(169, 250, 255)};
  font-family: "Courier New", monospace;
  letter-spacing: 0.12em;
  text-shadow: 0 0 12px ${c(54, 235, 255, 0.82)};
  pointer-events: none;
}

.map3d .holo-readout::before {
  content: "";
  position: absolute;
  top: -0.55rem;
  width: 2.8rem;
  height: 1px;
  background: ${c(99, 246, 255)};
  box-shadow: 0 0 10px ${c(36, 221, 236)};
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
  border: 1px solid ${c(102, 249, 255, 0.85)};
  border-left: 3px solid ${c(226, 254, 255)};
  color: ${c(216, 254, 255)};
  background: ${c(0, 30, 44, 0.84)};
  box-shadow: 0 0 18px ${c(57, 231, 255, 0.32)}, inset 0 0 12px ${c(94, 245, 255, 0.12)};
  font-family: "Courier New", monospace;
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
  color: ${c(184, 252, 255)};
  border-left: 2px solid ${c(108, 248, 255)};
  background: ${c(0, 22, 35, 0.74)};
  box-shadow: 0 0 14px ${c(37, 223, 246, 0.22)};
  font: 0.58rem/1.2 "Courier New", monospace;
  letter-spacing: 0.08em;
  pointer-events: none;
}

.map3d .map-credit {
  position: absolute;
  z-index: 700;
  right: 1rem;
  bottom: 1rem;
  color: ${c(159, 248, 255, 0.6)};
  font: 0.48rem "Courier New", monospace;
  letter-spacing: 0.06em;
  text-decoration: none;
  text-shadow: 0 0 7px ${c(61, 234, 255, 0.42)};
}

.map3d .map-credit:hover, .map3d .map-credit[data-twin-hover] { color: ${c(215, 254, 255)}; }

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
  border-radius: 50%;
  transform: translate(-50%, -50%);
}

.map3d .holo-location-beacon {
  width: 11px;
  height: 11px;
  background: ${c(213, 255, 255)};
  box-shadow: 0 0 7px ${c(86, 247, 255)}, 0 0 18px ${c(23, 221, 236)};
}

.map3d .holo-location-beacon::before,
.map3d .holo-location-beacon::after {
  width: 22px;
  height: 22px;
  border: 1.5px solid ${c(100, 250, 255)};
  box-shadow: 0 0 10px ${c(50, 232, 245)};
  animation: m3-location-pulse 2.1s ease-out infinite;
}

.map3d .holo-location-beacon::after { animation-delay: 1.05s; }

@keyframes m3-location-pulse {
  from { opacity: 0.9; transform: translate(-50%, -50%) scale(0.35); }
  to { opacity: 0; transform: translate(-50%, -50%) scale(2.1); }
}

.map3d .holo-location-tooltip {
  padding: 0.28rem 0.42rem !important;
  color: ${c(188, 253, 255)} !important;
  border: 1px solid ${c(93, 244, 255, 0.7)} !important;
  border-radius: 0 !important;
  background: ${c(0, 29, 44, 0.9)} !important;
  box-shadow: 0 0 12px ${c(34, 231, 249, 0.38)} !important;
  font: 0.55rem "Courier New", monospace !important;
  letter-spacing: 0.07em;
}

.map3d .holo-location-tooltip::before { border-top-color: ${c(93, 244, 255, 0.7)} !important; }

.map3d .hologram-map {
  background: transparent !important;
  box-shadow: inset 0 0 56px ${c(31, 228, 247, 0.22)}, inset 0 0 120px ${c(0, 0, 0, 0.82)};
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

.map3d .hologram-map .leaflet-control-zoom a {
  color: ${c(189, 252, 255)};
  background: ${c(1, 30, 44, 0.88)};
  border-bottom-color: ${c(72, 237, 255, 0.3)};
  text-shadow: 0 0 9px ${c(77, 239, 255, 0.6)};
}

.map3d .hologram-map .leaflet-control-zoom a:hover, .map3d .hologram-map .leaflet-control-zoom a[data-twin-hover] {
  color: ${c(255, 255, 255)};
  background: ${c(8, 104, 127, 0.92)};
}

.map3d .hologram-map .leaflet-control-attribution {
  color: ${c(166, 244, 250, 0.72)};
  background: ${c(1, 19, 31, 0.72)};
}

.map3d .hologram-map .leaflet-control-attribution a {
  color: ${c(114, 248, 255)};
}

@container (max-width: 640px) {
  .map3d .holo-readout { top: 4.6rem; }
  .map3d .holo-readout-left { left: 1rem; }
  .map3d .holo-readout-right { right: 1rem; }
  .map3d .holo-readout-right span, .map3d .holo-readout-right strong { display: none; }
}
`;
