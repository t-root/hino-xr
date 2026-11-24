import spec from "../wake.json";
import { clamp } from "../math/num";

// The words that wake things up (`src/shared/wake.json`, which the model server reads too) are spoken, so they stay as
// they are in every language: "system call" is not translated, and the assistant is called by its own name (`assistant.json`).
// The page does not hear them: the server does, and tells the page when one was said.

/** Seconds the assistant keeps listening after it was called or after it answered. */
export const LISTEN_RANGE: Readonly<{ min: number; max: number; step: number; default: number }> =
  spec.listenSeconds;

export const DEFAULT_LISTEN_SECONDS: number = spec.listenSeconds.default;

export const parseListenSeconds = (raw: unknown): number =>
  typeof raw === "number" && Number.isFinite(raw)
    ? clamp(raw, LISTEN_RANGE.min, LISTEN_RANGE.max)
    : DEFAULT_LISTEN_SECONDS;
