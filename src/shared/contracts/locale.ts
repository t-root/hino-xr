export const LOCALES = ["vi", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export type LocalizedText = Readonly<Record<Locale, string>>;

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

export const localized = (text: LocalizedText, locale: Locale): string => text[locale];

export const sameInEveryLocale = (text: string): LocalizedText => ({ vi: text, en: text });
