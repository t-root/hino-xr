import { useSharedUiStore } from "@/core/state/SharedUiStore";
import { SLOT_PX } from "@/ui/components/MenuStrip";

const STEP_DEG = 16;
const DEADBAND_DEG = 1.2;
const REST_MS = 450;
const MIN_HORIZONTAL = 0.3;
const DEG = Math.PI / 180;

const headingDelta = (to: number, from: number): number => {
  let delta = to - from;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
};

const backHeading = (alphaDeg: number, betaDeg: number, gammaDeg: number): number | null => {
  const a = alphaDeg * DEG;
  const b = betaDeg * DEG;
  const g = gammaDeg * DEG;
  const east = -(Math.cos(a) * Math.sin(g) + Math.sin(a) * Math.sin(b) * Math.cos(g));
  const north = -(Math.sin(a) * Math.sin(g) - Math.cos(a) * Math.sin(b) * Math.cos(g));
  if (Math.hypot(east, north) < MIN_HORIZONTAL) return null;
  return Math.atan2(east, north) / DEG;
};

export const installImuMenu = (): (() => void) => {
  let last: number | null = null;
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
    written = -(turned / STEP_DEG) * SLOT_PX;
    ui.setSettingsDrag(written);
  };

  window.addEventListener("deviceorientation", onOrientation);
  return () => {
    window.removeEventListener("deviceorientation", onOrientation);
    rest();
  };
};
