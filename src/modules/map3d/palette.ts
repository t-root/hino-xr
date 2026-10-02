import { DEFAULT_THEME, currentTheme, hexToHsl, hexToRgb, hslToHex } from "@/ui/theme";

/**
 * The original map3d colours, kept exactly, but owned by the theme.
 *
 * Every tone below is written as the RGB the original app used. At run time it
 * is turned around the colour wheel by however far the wearer has moved the
 * theme from its default: on the default theme the screen looks exactly like
 * the original, and when the theme changes the map follows it, keeping the
 * original's lightness and saturation tone for tone.
 *
 * Cyan tones follow the primary colour; the few warning reds (the remove
 * button) follow the accent.
 */
type Shift = Readonly<{ primary: number; accent: number }>;

let shift: Shift = { primary: 0, accent: 0 };

const hueOf = (hex: string): number => hexToHsl(hex).h;

/** Reads the theme again; call before building a screen or after it changes. */
export const syncPalette = (): boolean => {
  const theme = currentTheme();
  const next: Shift = {
    primary: hueOf(theme.primary) - hueOf(DEFAULT_THEME.primary),
    accent: hueOf(theme.accent) - hueOf(DEFAULT_THEME.accent),
  };
  const changed = next.primary !== shift.primary || next.accent !== shift.accent;
  shift = next;
  return changed;
};

const turn = (r: number, g: number, b: number, degrees: number): string => {
  const toByte = (value: number) => value.toString(16).padStart(2, "0");
  const original = `#${toByte(r)}${toByte(g)}${toByte(b)}`;
  if (degrees === 0) return original;
  const { h, s, l } = hexToHsl(original);
  return hslToHex((((h + degrees) % 360) + 360) % 360, s, l);
};

const withAlpha = (hex: string, alpha: number): string =>
  alpha >= 1 ? hex : `${hex}${Math.round(Math.max(0, alpha) * 255).toString(16).padStart(2, "0")}`;

/** A cyan tone of the original, as a CSS colour. */
export const c = (r: number, g: number, b: number, alpha = 1): string => withAlpha(turn(r, g, b, shift.primary), alpha);

/** A red tone of the original, as a CSS colour. */
export const a = (r: number, g: number, b: number, alpha = 1): string => withAlpha(turn(r, g, b, shift.accent), alpha);

/** A cyan tone of the original, as a number for three.js. */
export const cHex = (r: number, g: number, b: number): number => {
  const [red, green, blue] = hexToRgb(turn(r, g, b, shift.primary));
  return (red << 16) | (green << 8) | blue;
};
