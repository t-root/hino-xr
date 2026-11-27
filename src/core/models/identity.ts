import identity from "@/shared/assistant.json";
import type { Locale } from "@/shared/contracts/locale";

export const ASSISTANT_NAME: string = identity.name;

export const ACK: Readonly<Record<Locale, string>> = identity.ack;

export const DEFAULT_LOOKING: Readonly<Record<Locale, string>> = identity.looking;

export const DEFAULT_FAILED: Readonly<Record<Locale, string>> = identity.failed;
export const DEFAULT_NO_SCENE: Readonly<Record<Locale, string>> = identity.noScene;
export const DEFAULT_NO_CODE: Readonly<Record<Locale, string>> = identity.noCode;

export const LINE_KEYS = ["looking", "failed", "noScene", "noCode"] as const;
export type LineKey = (typeof LINE_KEYS)[number];

export const DEFAULT_GREETING: Readonly<Record<Locale, string>> = identity.greeting;
