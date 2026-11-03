/**
 * The interface font, for the places CSS cannot reach (text drawn on a canvas).
 * The same stack is `--font` in `styles.css`; the face itself is declared there.
 */
export const FONT_FAMILY = '"ct-squarefont-vn", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * Asks for the font before anything is drawn on a canvas: a canvas never redraws
 * itself when a font arrives late, so a label made too early would keep the fallback.
 * Waits a moment at most; a missing network or font is not a reason to hold the app.
 */
export const loadInterfaceFont = async (timeoutMs = 2000): Promise<void> => {
  if (typeof document === "undefined" || !document.fonts) return;
  const load = document.fonts.load(`600 16px ${FONT_FAMILY}`).then(() => undefined);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  await Promise.race([load, timeout]).catch(() => undefined);
};
