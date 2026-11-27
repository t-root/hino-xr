export const spaceScannerCss = (): string => `
.ar-space,
.ar-space * {
  box-sizing: border-box;
  border-radius: 0;
}

.ar-space {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  user-select: none;
  color: var(--text);
}

.ar-space__stage {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.ar-space__stage canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.ar-space__box {
  position: absolute;
  z-index: 18;
  border: 1px solid var(--ui-ink);
  background: var(--surface);
  pointer-events: none;
}

.ar-space__box[hidden] {
  display: none;
}

.ar-space__bar {
  position: absolute;
  z-index: 25;
  top: 12cqb;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 1.4cqi;
}

.ar-space__btn {
  padding: 1cqb 2.2cqi;
  background: var(--surface);
  border: 1px solid var(--hairline);
  color: var(--text-dim);
  font-size: 2.4cqi;
  letter-spacing: 0.05em;
  cursor: pointer;
  white-space: nowrap;
}

.ar-space__btn[data-active="true"],
.ar-space__btn:hover,
.ar-space__btn[data-twin-hover] {
  color: var(--ui-ink);
  border-color: var(--ui-ink);
  background: var(--surface-strong);
}

.ar-space__spec {
  position: absolute;
  z-index: 20;
  bottom: 12cqb;
  left: 50%;
  transform: translateX(-50%);
  padding: 0.8cqb 2.2cqi;
  background: var(--surface);
  border: 1px solid var(--hairline);
  color: var(--ui-ink);
  font-size: 2.1cqi;
  letter-spacing: 0.04em;
  pointer-events: none;
  white-space: nowrap;
}

.ar-space__spec[hidden] {
  display: none;
}
`;
