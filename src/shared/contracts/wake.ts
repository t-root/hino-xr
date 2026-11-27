import spec from "../wake.json";
import { clamp } from "../math/num";

export const LISTEN_RANGE: Readonly<{ min: number; max: number; step: number; default: number }> =
  spec.listenSeconds;

export const DEFAULT_LISTEN_SECONDS: number = spec.listenSeconds.default;

export const parseListenSeconds = (raw: unknown): number =>
  typeof raw === "number" && Number.isFinite(raw)
    ? clamp(raw, LISTEN_RANGE.min, LISTEN_RANGE.max)
    : DEFAULT_LISTEN_SECONDS;
