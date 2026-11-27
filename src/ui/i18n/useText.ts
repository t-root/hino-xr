import { currentLocale, useLocaleStore } from "@/core/state/LocaleStore";
import { TEXT, fill, type MessageKey, type TextValues } from "@/i18n/text";
import { localized, type LocalizedText } from "@/shared/contracts/locale";

type Translate = (key: MessageKey, values?: TextValues) => string;

export const t: Translate = (key, values) => fill(TEXT[key][currentLocale()], values);

export const loc = (text: LocalizedText): string => localized(text, currentLocale());

export const watchLocale = (onChange: () => void): (() => void) =>
  useLocaleStore.subscribe(onChange);
