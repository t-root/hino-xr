import * as z from "zod/mini";
import en from "zod/v4/locales/en.js";
import type { DetectionBatch, ModuleManifest } from "../contracts/vision";

/*
 * `zod/mini`, not `zod`: the same checks in a functional form, at about a
 * tenth of the bundle (the full build pulls in every method on every schema).
 * Mini ships no messages of its own, so the English ones are loaded here; they
 * only reach the log, when a plugin's manifest or batch is malformed.
 */
z.config(en());

const normalized = z.number().check(z.gte(0), z.lte(1));

/**
 * Text in every language the app speaks. Strict and required per locale: a
 * manifest that ships one language would leave a blank card in the other.
 */
const localizedTextSchema = z.strictObject({
  vi: z.string().check(z.minLength(1)),
  en: z.string().check(z.minLength(1)),
});

const normalizedRectSchema = z.strictObject({
  x: z.number().check(z.gte(-0.5), z.lte(1.5)),
  y: z.number().check(z.gte(-0.5), z.lte(1.5)),
  width: z.number().check(z.gte(0), z.lte(2)),
  height: z.number().check(z.gte(0), z.lte(2)),
});

const detectionSchema = z.strictObject({
  id: z.string().check(z.minLength(1)),
  kind: z.string().check(z.minLength(1)),
  bounds: normalizedRectSchema,
  confidence: normalized,
  label: z.optional(z.string()),
  attributes: z.optional(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))),
  interaction: z.optional(
    z.strictObject({
      selectable: z.optional(z.boolean()),
      draggable: z.optional(z.boolean()),
      detailAction: z.optional(z.string()),
    }),
  ),
});

const detectionBatchSchema = z.strictObject({
  moduleId: z.string().check(z.minLength(1)),
  sourceFrameId: z.int().check(z.gte(0)),
  producedAtMs: z.number().check(z.gte(0)),
  detections: z.array(detectionSchema).check(z.maxLength(256)),
});

const moduleManifestSchema = z.strictObject({
  id: z.string().check(z.minLength(1), z.regex(/^[a-z0-9][a-z0-9-]*$/, "module id must be kebab-case")),
  version: z.string().check(z.regex(/^\d+\.\d+\.\d+/, "version must be semver")),
  displayName: localizedTextSchema,
  description: localizedTextSchema,
  input: z.strictObject({
    preferredFps: z.number().check(z.gt(0), z.lte(60)),
    maxWidth: z.optional(z.int().check(z.gt(0))),
    maxHeight: z.optional(z.int().check(z.gt(0))),
  }),
  outputKinds: z.array(z.string().check(z.minLength(1))).check(z.minLength(1)),
  execution: z.enum(["worker", "main", "remote"]),
  permissions: z.array(z.enum(["camera-frame", "network", "snapshot", "screen"])),
});

type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

type Issues = Readonly<{ issues: ReadonlyArray<Readonly<{ path: readonly PropertyKey[]; message: string }>> }>;

const formatIssues = (error: Issues): string =>
  error.issues.map((issue) => `${issue.path.map(String).join(".") || "<root>"}: ${issue.message}`).join("; ");

export const validateDetectionBatch = (input: unknown): ValidationResult<DetectionBatch> => {
  const parsed = detectionBatchSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data as DetectionBatch }
    : { ok: false, error: formatIssues(parsed.error) };
};

export const validateModuleManifest = (input: unknown): ValidationResult<ModuleManifest> => {
  const parsed = moduleManifestSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data as ModuleManifest }
    : { ok: false, error: formatIssues(parsed.error) };
};
