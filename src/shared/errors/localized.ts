import { sameInEveryLocale, type LocalizedText } from "@/shared/contracts/locale";

/**
 * An error whose message is meant to be read by the person using the app.
 *
 * `Error.message` is one string, and the language it is written in is decided
 * where the error is thrown — usually far from the screen, sometimes by the
 * browser. Carrying the text in every locale lets the failure travel through
 * the runtime the same way it always did, and still be read in the language the
 * interface is set to.
 */
export class LocalizedError extends Error {
  constructor(readonly text: LocalizedText) {
    super(text.en);
    this.name = "LocalizedError";
  }
}

/**
 * Reads a failure as something displayable.
 *
 * Errors from the browser and from plugin code have no translation and never
 * will, so they come through as they are: an untranslated sentence a user can
 * search for beats a translated one that hides what happened.
 */
export const localizedTextOf = (error: unknown): LocalizedText => {
  if (error instanceof LocalizedError) return error.text;
  if (error instanceof Error) return sameInEveryLocale(error.message);
  return sameInEveryLocale(String(error));
};
