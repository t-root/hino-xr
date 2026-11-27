export const requestAppFullscreen = async (element: HTMLElement): Promise<boolean> => {
  if (typeof document === "undefined") return false;
  if (document.fullscreenElement === element) return true;
  const candidate = element as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  try {
    if (typeof element.requestFullscreen === "function") {
      await element.requestFullscreen({ navigationUI: "hide" });
      return document.fullscreenElement === element || document.fullscreenElement !== null;
    }
    candidate.webkitRequestFullscreen?.call(element);
    return true;
  } catch {
    return false;
  }
};

export const unlockViewOrientation = async (): Promise<void> => {
  if (typeof screen === "undefined") return;
  try {
    screen.orientation.unlock();
  } catch {
  }
};
