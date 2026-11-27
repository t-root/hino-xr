export type Place = Readonly<{ lat: number; lon: number }>;

const MAX_AGE_MS = 10 * 60_000;

let last: Place | null = null;

const rounded = (value: number): number => Math.round(value * 100) / 100;

export const rememberPlace = (position: GeolocationPosition): void => {
  last = { lat: rounded(position.coords.latitude), lon: rounded(position.coords.longitude) };
};

export const rememberedPlace = (): Place | null => last;

export const refreshPlace = (): void => {
  if (typeof navigator === "undefined" || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(rememberPlace, () => undefined, {
    enableHighAccuracy: false,
    maximumAge: MAX_AGE_MS,
    timeout: 8_000,
  });
};
