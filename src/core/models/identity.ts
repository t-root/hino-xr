import identity from "@/shared/assistant.json";
import type { Locale } from "@/shared/contracts/locale";

/**
 * The assistant's spoken name. Change `src/shared/assistant.json` — that file
 * is the only place the name is written, and the model server reads it too.
 */
export const ASSISTANT_NAME: string = identity.name;

/** What it says the moment it hears its name and nothing else, so the wearer knows it listens. */
export const ACK: Readonly<Record<Locale, string>> = identity.ack;

/** What it says when asked to look at the screen or at something held up, until the wearer writes their own. */
export const DEFAULT_LOOKING: Readonly<Record<Locale, string>> = identity.looking;

/** What the assistant says first, per language, until the wearer writes their own. */
export const DEFAULT_GREETING: Readonly<Record<Locale, string>> = identity.greeting;
