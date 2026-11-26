/**
 * Where the device is, for the one thing that asks: the weather, when no city is said.
 *
 * The page already holds the location permission (`DeviceAccess`), so no new prompt is made here. The last known fix is kept,
 * refreshed in the background, and handed to the server rounded to two decimals (about a kilometre): enough for a forecast,
 * not enough to point at a house. Nothing is sent when the permission is not granted or no fix has come.
 */

export type Place = Readonly<{ lat: number; lon: number }>;

/** A fix this old is read again; the position of a person wearing a headset hardly moves in ten minutes. */
const MAX_AGE_MS = 10 * 60_000;

let last: Place | null = null;

const rounded = (value: number): number => Math.round(value * 100) / 100;

/** Keeps a fix the browser gave. */
export const rememberPlace = (position: GeolocationPosition): void => {
  last = { lat: rounded(position.coords.latitude), lon: rounded(position.coords.longitude) };
};

/** The last known place, or null. */
export const rememberedPlace = (): Place | null => last;

/** Asks the browser again in the background, from its own cache when it is fresh enough. Never throws, never waits. */
export const refreshPlace = (): void => {
  if (typeof navigator === "undefined" || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(rememberPlace, () => undefined, {
    enableHighAccuracy: false,
    maximumAge: MAX_AGE_MS,
    timeout: 8_000,
  });
};
