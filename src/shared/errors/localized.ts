import { sameInEveryLocale, type LocalizedText } from "@/shared/contracts/locale";

export class LocalizedError extends Error {
  constructor(readonly text: LocalizedText) {
    super(text.en);
    this.name = "LocalizedError";
  }
}

export const localizedTextOf = (error: unknown): LocalizedText => {
  if (error instanceof LocalizedError) return error.text;
  if (error instanceof Error) return sameInEveryLocale(error.message);
  return sameInEveryLocale(String(error));
};
