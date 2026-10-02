export const LOCALES = ["vi", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * A piece of text in every language the app speaks.
 *
 * A record rather than a lookup key, because this is the form text takes when
 * it is written far from the interface: a plugin's own folder, a camera error,
 * the reason stereo had to be given up. Those places have no dictionary to
 * belong to, and a key that resolves to nothing is a blank space on screen.
 * Adding a locale here turns every missing translation into a type error.
 */
export type LocalizedText = Readonly<Record<Locale, string>>;

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

export const localized = (text: LocalizedText, locale: Locale): string => text[locale];

/** The same sentence in every language, for text that has no translation. */
export const sameInEveryLocale = (text: string): LocalizedText => ({ vi: text, en: text });
