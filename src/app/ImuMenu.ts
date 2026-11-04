import { useSharedUiStore } from "@/core/state/SharedUiStore";
import { SLOT_PX } from "@/ui/components/MenuStrip";

/** Turning the head this far moves the menu band by one entry. */
const STEP_DEG = 16;
/** Turns slower than this are the head settling, not a gesture; the band eases back. */
const DEADBAND_DEG = 1.2;
/** Still for this long and the half-made step is given up. */
const REST_MS = 450;
/** Looking nearly straight up or down leaves no heading to read. */
const MIN_HORIZONTAL = 0.3;
const DEG = Math.PI / 180;

/** Signed difference of two compass headings, -180..180. */
const headingDelta = (to: number, from: number): number => {
  let delta = to - from;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
};

/**
 * Where the back of the device points on the horizon, in degrees clockwise,
 * from the orientation angles alone (W3C Z-X'-Y'' order). The back of the
 * device points the same way the camera looks, however the phone is turned in
 * the headset — portrait, either landscape, or flipped — so the heading is the
 * same number for the same head turn and no screen angle needs to be asked.
 */
const backHeading = (alphaDeg: number, betaDeg: number, gammaDeg: number): number | null => {
  const a = alphaDeg * DEG;
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  // The device's z axis (out of the screen) in earth coordinates; the back is its opposite.
  const east = -(Math.cos(a) * Math.sin(g) + Math.sin(a) * Math.sin(b) * Math.cos(g));
  const north = -(Math.sin(a) * Math.sin(g) - Math.cos(a) * Math.sin(b) * Math.cos(g));
  if (Math.hypot(east, north) < MIN_HORIZONTAL) return null;
  return Math.atan2(east, north) / DEG;
};

/**
 * Debug-free head control of the menu band: turn the head right and the band
 * runs to the next entry, turn it left and it runs back. The band follows the
 * turn as it happens and settles on the nearest entry, as a swipe does.
 *
 * Only acts while the band itself is on screen, and stands aside whenever a
 * hand is dragging it.
 */
export const installImuMenu = (): (() => void) => {
  let last: number | null = null;
  /** Degrees turned since the last settled entry; clockwise (right) is positive. */
  let turned = 0;
  let lastMoveMs = 0;
  let written = 0;

  const active = (): boolean => {
    const ui = useSharedUiStore.getState();
    return ui.menuOpen && !ui.settingsDetail && !ui.starting && !ui.armed;
  };

  const rest = () => {
    turned = 0;
    if (written !== 0) {
      written = 0;
      useSharedUiStore.getState().setSettingsDrag(0);
    }
  };

  const onOrientation = (event: DeviceOrientationEvent): void => {
    if (event.alpha === null || event.beta === null || event.gamma === null) return;
    const heading = backHeading(event.alpha, event.beta, event.gamma);
    if (heading === null) {
      last = null;
      return;
    }
    const previous = last;
    last = heading;
    if (previous === null || !active()) {
      if (!active()) rest();
      return;
    }
    const ui = useSharedUiStore.getState();
    // A hand is dragging the band: its offset is not ours.
    if (ui.settingsDrag !== written) return;

    const now = performance.now();
    const delta = headingDelta(heading, previous);
    if (Math.abs(delta) < DEADBAND_DEG / 10) {
      if (now - lastMoveMs > REST_MS) rest();
      return;
    }
    lastMoveMs = now;
    turned += delta;

    if (Math.abs(turned) >= STEP_DEG) {
      const step = Math.sign(turned);
      turned -= step * STEP_DEG;
      written = 0;
      ui.settleSettingsBand(ui.settingsSlot + step, 0);
      return;
    }
    // Turning right brings the next entry in from the right: the band moves left.
    written = -(turned / STEP_DEG) * SLOT_PX;
    ui.setSettingsDrag(written);
  };

  window.addEventListener("deviceorientation", onOrientation);
  return () => {
    window.removeEventListener("deviceorientation", onOrientation);
    rest();
  };
};
