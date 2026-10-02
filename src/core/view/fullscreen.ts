/**
 * Puts the app in the screen's fullscreen. Must run from a tap — browsers
 * refuse otherwise — which is why Start is the call site, not the runtime.
 *
 * Failure is silent: iPhone Safari and desktop without a gesture still have to
 * open the camera. Windowed is worse than fullscreen, not a reason to stop.
 */
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

/**
 * Lets the device turn freely. The layout always cuts the long side into two
 * squares, and the wearer rotates the picture with the button, so a screen
 * lock would only fight both.
 *
 * Only works after fullscreen on most phones. A refusal is normal on desktop
 * and on iOS.
 */
export const unlockViewOrientation = async (): Promise<void> => {
  if (typeof screen === "undefined") return;
  try {
    screen.orientation.unlock();
  } catch {
    // Unlock is optional: the square split still follows the window.
  }
};
