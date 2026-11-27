import { DEFAULT_THEME, currentTheme, hexToHsl, hexToRgb, hslToHex } from "@/ui/theme";

type Shift = Readonly<{ primary: number; accent: number }>;

let shift: Shift = { primary: 0, accent: 0 };

const hueOf = (hex: string): number => hexToHsl(hex).h;

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

export const c = (r: number, g: number, b: number, alpha = 1): string => withAlpha(turn(r, g, b, shift.primary), alpha);

export const a = (r: number, g: number, b: number, alpha = 1): string => withAlpha(turn(r, g, b, shift.accent), alpha);

export const cHex = (r: number, g: number, b: number): number => {
  const [red, green, blue] = hexToRgb(turn(r, g, b, shift.primary));
  return (red << 16) | (green << 8) | blue;
};
