import identity from "@/shared/assistant.json";
import type { Locale } from "@/shared/contracts/locale";

/**
 * The assistant's spoken name. Change `src/shared/assistant.json` — that file
 * is the only place the name is written, and the model server reads it too.
 */
export const ASSISTANT_NAME: string = identity.name;

/** What the assistant says first, per language, until the wearer writes their own. */
export const DEFAULT_GREETING: Readonly<Record<Locale, string>> = identity.greeting;
