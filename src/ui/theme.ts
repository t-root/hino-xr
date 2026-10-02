import { clamp, clamp01 } from "@/shared/math/num";

/**
 * Colours of the interface.
 *
 * The primary token paints every ordinary surface, label, outline and cursor.
 * The accent token is reserved for things that have to stand apart from that
 * field: errors, warnings, log lines that failed, the notices on Start.
 * Opacity scales the token before it is mixed, so turning it down thins the
 * whole UI rather than punching a hole in one control.
 */
export type ThemeSettings = Readonly<{
  primary: string;
  primaryOpacity: number;
  accent: string;
  accentOpacity: number;
}>;

export const DEFAULT_THEME: ThemeSettings = {
  primary: "#a9e7ff",
  primaryOpacity: 1,
  accent: "#ff4d4d",
  accentOpacity: 1,
};

/** Alpha scale. Hierarchy comes from transparency, never from a third hue. */
export const ALPHA = {
  hairline: 0.14,
  surface: 0.08,
  surfaceStrong: 0.14,
  textFaint: 0.28,
  textDim: 0.55,
  text: 0.88,
  focus: 1,
} as const;

export const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);

type Rgb = readonly [number, number, number];

type Hsl = Readonly<{ h: number; s: number; l: number }>;

export const hexToRgb = (hex: string): Rgb => {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((character) => character + character)
          .join("")
      : value;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
};

const rgbToHex = (r: number, g: number, b: number): string => {
  const byte = (channel: number): string =>
    clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
};

export const hexToHsl = (hex: string): Hsl => {
  const [r8, g8, b8] = hexToRgb(hex);
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: light * 100 };
  const delta = max - min;
  const sat = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;
  if (max === r) hue = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
  else if (max === g) hue = ((b - r) / delta + 2) / 6;
  else hue = ((r - g) / delta + 4) / 6;
  return { h: hue * 360, s: sat * 100, l: light * 100 };
};

export const hslToHex = (h: number, s: number, l: number): string => {
  const sat = s / 100;
  const light = l / 100;
  const chroma = sat * Math.min(light, 1 - light);
  const channel = (n: number): number => {
    const k = (n + h / 30) % 12;
    return light - chroma * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return rgbToHex(channel(0) * 255, channel(8) * 255, channel(4) * 255);
};

const pack = ([r, g, b]: Rgb): number => (r << 16) | (g << 8) | b;

const rgbaOf = (rgb: Rgb, alpha: number): string =>
  `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${clamp01(alpha)})`;

let current: ThemeSettings = DEFAULT_THEME;
let primaryRgb: Rgb = hexToRgb(DEFAULT_THEME.primary);

export const currentTheme = (): ThemeSettings => current;

export const uiColor = (alpha: number): string => rgbaOf(primaryRgb, alpha * current.primaryOpacity);

export const uiColorHex = (): number => pack(primaryRgb);

/**
 * The void behind the camera image. Pure black so a 1px raster gap cannot
 * show a tinted hairline between the picture and the stage.
 */
export const voidHex = (): number => 0;

/** Neutral multiplier for textured materials: shows the texture untinted. */
export const TEXTURE_NEUTRAL_TINT = 0xffffff;

/**
 * Publishes the tokens to CSS and to the live getters the renderer reads.
 * Called at startup and whenever the wearer moves a colour slider.
 */
export const applyTheme = (theme: ThemeSettings): void => {
  current = theme;
  primaryRgb = hexToRgb(theme.primary);
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  root.setProperty("--ui-color", theme.primary);
  root.setProperty("--ui-accent", theme.accent);
  root.setProperty("--ui-color-alpha", String(theme.primaryOpacity));
  root.setProperty("--ui-accent-alpha", String(theme.accentOpacity));
};
