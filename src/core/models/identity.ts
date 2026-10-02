import identity from "@/shared/assistant.json";

/**
 * The assistant's spoken name. Change `src/shared/assistant.json` — that file
 * is the only place the name is written, and the model server reads it too.
 */
export const ASSISTANT_NAME: string = identity.name;
