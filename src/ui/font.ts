export const FONT_FAMILY = '"ct-squarefont-vn", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const loadInterfaceFont = async (timeoutMs = 2000): Promise<void> => {
  if (typeof document === "undefined" || !document.fonts) return;
  const load = document.fonts.load(`600 16px ${FONT_FAMILY}`).then(() => undefined);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  await Promise.race([load, timeout]).catch(() => undefined);
};
