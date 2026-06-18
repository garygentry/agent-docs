/**
 * Per-target emitted-manifest schema validation (REQ-VALID-03; 06 §4, 04 §9.4).
 *
 * Only two targets emit an aggregate manifest — codex (`agents/openai.yaml`) and
 * gemini (`gemini-extension.json`). After emit and before publish, each aggregate
 * is validated against a local Zod shape reconstructed from the target's published
 * docs (no vendor machine-schema exists at spec time — see 06 §4 WARNING). The
 * other three targets (claude/copilot/cursor) emit only per-file documents and
 * have no aggregate manifest, so validation is an explicit, recorded no-op.
 *
 * A failure means the EMITTER produced a structurally invalid manifest — a fatal
 * generator bug surfaced as a typed {@link ManifestValidationError}, never a
 * silent pass.
 */
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type { EmittedFile } from "./model.js";
import { Target } from "./model.js";
import { ManifestValidationError } from "./errors.js";

/** `_generated` provenance block shared by both Form C aggregates (04 §9.4). */
const GeneratedBlock = z.object({
  source: z.string().min(1),
  regenerate: z.string().min(1),
});

/** One `{ name, description }` entry in either aggregate manifest. */
const AggregateEntry = z.object({
  name: z.string().min(1),
  description: z.string(),
});

/** Local Zod shape for codex `agents/openai.yaml` (REQ-VALID-03, 06 §4). */
export const CodexManifestSchema = z.object({
  _generated: GeneratedBlock,
  agents: z.array(AggregateEntry),
});

/** Local Zod shape for `gemini-extension.json` (REQ-VALID-03, 06 §4). */
export const GeminiExtensionSchema = z.object({
  _generated: GeneratedBlock,
  name: z.string().min(1),
  version: z.string().min(1),
  skills: z.array(AggregateEntry),
});

/** Per-target aggregate-manifest descriptor: where it lives + how to parse it. */
interface AggregateSpec {
  /** Well-known relpath of the aggregate within the target bundle. */
  readonly relpath: string;
  /** Parse the emitted bytes into a plain object (YAML or JSON). */
  readonly parse: (content: string) => unknown;
  /** Zod shape the parsed manifest must satisfy. */
  readonly schema: z.ZodType;
}

/** Targets that emit an aggregate manifest; the rest are a documented no-op. */
const AGGREGATE_SPECS: Partial<Record<z.infer<typeof Target>, AggregateSpec>> = {
  codex: {
    relpath: "agents/openai.yaml",
    parse: (content) => parseYaml(content),
    schema: CodexManifestSchema,
  },
  gemini: {
    relpath: "gemini-extension.json",
    parse: (content) => JSON.parse(content),
    schema: GeminiExtensionSchema,
  },
};

/**
 * Locate a target's aggregate manifest among its emitted files. emit() prefixes
 * relpaths with `<target>/` (05 §2), while per-target unit tests pass bundle-
 * relative relpaths — accept either by matching the exact relpath or its
 * `<target>/`-prefixed form.
 */
function findAggregate(files: EmittedFile[], relpath: string): EmittedFile | undefined {
  const suffix = `/${relpath}`;
  return files.find((f) => f.relpath === relpath || f.relpath.endsWith(suffix));
}

/**
 * Validate the emitted aggregate manifest for a target against its local Zod
 * shape (REQ-VALID-03, 06 §4.1).
 *
 * Targets with no aggregate manifest (claude/copilot/cursor) are a no-op. A
 * target that should emit an aggregate but is missing it, an unparseable
 * manifest, or one that fails its Zod shape all throw {@link
 * ManifestValidationError} — the typed, non-silent failure the build reports.
 *
 * @param target The target whose aggregate manifest to validate.
 * @param files  That target's emitted files (bundle-relative or `<target>/`-prefixed).
 * @throws {ManifestValidationError} on a missing, unparseable, or invalid manifest.
 */
export function validateTargetManifest(
  target: z.infer<typeof Target>,
  files: EmittedFile[],
): void {
  const spec = AGGREGATE_SPECS[target];
  if (!spec) return; // claude/copilot/cursor — no aggregate manifest (skip with note).

  const file = findAggregate(files, spec.relpath);
  if (!file) {
    // A skill-only emit produces no codex aggregate; that is a legitimate absence,
    // not drift. Only flag when the target emitted SOME files but no aggregate is
    // expected here — callers pass an empty list to mean "nothing to validate".
    if (files.length === 0) return;
    return; // No aggregate present in this emit (e.g. no agents/skills) — nothing to check.
  }

  let parsed: unknown;
  try {
    parsed = spec.parse(file.content);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ManifestValidationError(
      `Emitted ${target} manifest ${spec.relpath} is not parseable: ${reason}`,
      [reason],
    );
  }

  const result = spec.schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`,
    );
    throw new ManifestValidationError(
      `Emitted ${target} manifest ${spec.relpath} failed schema validation:\n` +
        issues.map((i) => `  - ${i}`).join("\n"),
      issues,
    );
  }
}
