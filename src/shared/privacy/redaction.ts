/**
 * Telemetry and diagnostics must never carry recognised text, plate numbers or
 * any raw image data. Everything that leaves the runtime passes through here.
 */

const SENSITIVE_KEYS =
  /^(label|text|plate|name|email|token|secret|image|frame|snapshot|lat|latitude|lng|longitude|coords|altitude|accuracy)$/i;

const redactLabel = (label: string): string => {
  const trimmed = label.trim();
  if (trimmed.length === 0) return "";
  return `${trimmed.slice(0, 1)}${"*".repeat(Math.max(trimmed.length - 1, 1))}`;
};

export const redactRecord = (input: Readonly<Record<string, unknown>>): Record<string, unknown> => {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEYS.test(key)) {
      output[key] = typeof value === "string" ? redactLabel(value) : "[redacted]";
      continue;
    }
    output[key] =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? redactRecord(value as Record<string, unknown>)
        : value;
  }
  return output;
};
