/**
 * The look of the plugin's screen, scoped under `.face-id` so none of it reaches the rest of the interface.
 * Colours are the interface's own (variables from the theme), sizes are shares of the screen box (cqi, cqb).
 */
export const faceRecognitionCss = (): string => `
.face-id {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-size: clamp(8px, 2.5cqb, 14px);
  color: var(--text);
}

/* Small and light: a strip at the foot of the picture, not a panel over it. */
.face-id .fid-card {
  position: absolute;
  left: 50%;
  bottom: 12cqb;
  transform: translateX(-50%);
  width: max-content;
  max-width: min(76cqi, 108cqb);
  max-height: 70cqb;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 0.7cqb;
  padding: 0.9cqb;
  background: var(--surface);
  backdrop-filter: blur(3px);
  border: 1px solid var(--hairline);
  pointer-events: auto;
}

.face-id .fid-status[data-kind="known"] { color: var(--ui-ink); }
.face-id .fid-status[data-kind="none"] { color: var(--text-dim); }

.face-id .fid-message { color: var(--text-dim); }

.face-id .fid-actions { display: flex; gap: 0.7cqb; flex-wrap: wrap; justify-content: center; }

.face-id .fid-button {
  flex: 0 0 auto;
  min-width: 0;
  padding: 0.8cqb 1.6cqb;
  font-size: 0.92em;
  border: 1px solid var(--hairline);
  background: var(--surface);
  color: var(--text);
  font: inherit;
}

.face-id .fid-button:hover,
.face-id .fid-button[data-twin-hover] {
  background: var(--surface-strong);
  color: var(--ui-ink);
}

.face-id .fid-button[data-hand-press] { border-color: var(--ui-ink); }
.face-id .fid-primary { color: var(--ui-ink); border-color: var(--ui-ink); }
.face-id .fid-button:disabled { opacity: 0.5; }

/* Name beside year of birth, the note under them: three short fields in two rows. */
.face-id .fid-form { display: grid; grid-template-columns: 2fr 1fr; gap: 0.7cqb; width: min(66cqi, 96cqb); }
.face-id .fid-form .fid-field:nth-child(3),
.face-id .fid-form .fid-actions { grid-column: 1 / -1; }
.face-id .fid-field { display: flex; flex-direction: column; gap: 0.4cqb; }
.face-id .fid-label { color: var(--text-dim); }

.face-id .fid-input {
  width: 100%;
  box-sizing: border-box;
  padding: 0.8cqb;
  border: 1px solid var(--hairline);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  resize: none;
}

.face-id .fid-list { max-height: 30cqb; overflow: hidden; }
.face-id .fid-people { display: flex; flex-direction: column; gap: 0.8cqb; }
.face-id .fid-person { display: flex; align-items: center; gap: 1cqb; }
.face-id .fid-person-name { flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.face-id .fid-person .fid-button { flex: 0 0 auto; padding: 0.7cqb 1.2cqb; }
.face-id .fid-empty { color: var(--text-dim); }

/* The hidden attribute must win over the display set on a section above. */
.face-id [hidden] { display: none !important; }
`;
