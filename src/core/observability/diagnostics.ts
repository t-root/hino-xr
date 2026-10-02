import { redactRecord } from "@/shared/privacy/redaction";
import { ENV } from "@/env";
import type { EventBus } from "../events/EventBus";
import type { RuntimeEvents } from "../events/events";

export type Logger = Readonly<{
  debug(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}>;

/**
 * Folds the context into the line itself. A console that prints `Object` next
 * to "failed to start" hides the one thing worth reading, and the `diagnostic`
 * event only ever carried the message, so the reason never reached the panel
 * either. Redacted on the way in, because this text is what leaves as telemetry.
 */
const describe = (context?: Record<string, unknown>): string => {
  if (!context) return "";
  const parts = Object.entries(redactRecord(context)).map(
    ([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`,
  );
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
};

export const createLogger = (scope: string, bus?: EventBus<RuntimeEvents>): Logger => {
  const emit = (level: "debug" | "warn" | "error", message: string, context?: Record<string, unknown>) => {
    const detailed = `${message}${describe(context)}`;
    const line = `[${scope}] ${detailed}`;
    if (level === "error") console.error(line, context ?? "");
    else if (level === "warn") console.warn(line, context ?? "");
    else if (ENV.DEV) console.debug(line, context ?? "");
    bus?.emit("diagnostic", { level, scope, message: detailed });
  };

  return {
    debug: (message, context) => emit("debug", message, context),
    warn: (message, context) => emit("warn", message, context),
    error: (message, context) => emit("error", message, context),
  };
};
