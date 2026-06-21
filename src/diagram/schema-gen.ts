#!/usr/bin/env bun
/**
 * schema-gen.ts — JSON-Schema generation & drift guard for the diagram input spec.
 *
 * Sibling of the repo-root src/schema-gen.ts (which hardwires the Manifest; not
 * parameterized — tech-spec §3.2). Mirrors that file's pattern exactly: a pure
 * builder over the Zod `DiagramSpec` source of truth (00 §2.4) plus a side-effectful
 * CLI that either WRITES the committed schema or, with `--check`, regenerates in
 * memory and diffs against the committed file (exit non-zero on drift). Wired into
 * `gate` via `schema:check:diagram` (01 §5). Reuses ONLY the `zodToJsonSchema`
 * import from `zod-to-json-schema`.
 *
 * Usage:
 *   bun run src/diagram/schema-gen.ts            # regenerate + write the committed schema
 *   bun run src/diagram/schema-gen.ts --check    # drift guard: fail if the committed copy is stale
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { DiagramSpec } from "./schema.js";

/** Committed JSON Schema output path (relative to repo root). Single committed copy. */
export const DIAGRAM_SCHEMA_OUTPUT_PATH = "schemas/diagram-input.schema.json" as const;

/**
 * Build the diagram-input JSON Schema OBJECT from the Zod `DiagramSpec` source of
 * truth (00 §2.4). Pure: no filesystem, no clock — safe to call from both the writer
 * and the drift check, guaranteeing they compare identical values.
 *
 * Uses `$refStrategy: "none"` so the schema is fully inlined (matches the manifest
 * generator). Key order is deterministic: zod-to-json-schema emits keys in a stable
 * order for a fixed Zod input, and the metadata keys ($schema/$id/title/description)
 * are appended in fixed order — so two calls yield byte-identical JSON when
 * serialized.
 *
 * Note: the cross-field `superRefine` (§2) is NOT representable in JSON Schema; the
 * generated document captures per-field shape only. Cross-field invariants are a
 * runtime check (parseSpec, §2.4). This is documented in `description` so consumers
 * of the JSON Schema are not surprised.
 *
 * @returns The JSON Schema as a plain object.
 */
export function buildDiagramSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(DiagramSpec, { $refStrategy: "none" }) as Record<string, unknown>;
  schema["$schema"] = "http://json-schema.org/draft-07/schema#";
  schema["$id"] = "diagram-input.schema.json";
  schema["title"] = "Diagram Generator Input Spec";
  schema["description"] =
    "Engine-neutral DiagramSpec for the diagram-generator skill (REQ-IN-02). " +
    "Per-field shape only; cross-field referential/type-agreement invariants are " +
    "enforced at runtime (02-schema-and-validation.md §2), not in this schema.";
  return schema;
}

/**
 * Build the diagram-input JSON Schema TEXT: the object from {@link buildDiagramSchema}
 * serialized as pretty-printed JSON (2-space indent) with a trailing newline so the
 * committed file is POSIX-clean and byte-stable. This is what gets written/diffed.
 *
 * @returns The pretty-printed JSON Schema text (2-space indent, trailing newline).
 */
export function buildDiagramSchemaJson(): string {
  return JSON.stringify(buildDiagramSchema(), null, 2) + "\n";
}

// ─── CLI entry (side-effectful: skipped on import) ──────────────────

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dirname, "..", "..");
  const check = process.argv.includes("--check");
  const output = buildDiagramSchemaJson();
  const abs = resolve(repoRoot, DIAGRAM_SCHEMA_OUTPUT_PATH);

  if (check) {
    // Drift guard: regenerate in memory, diff against the committed file.
    const current = existsSync(abs) ? readFileSync(abs, "utf-8") : "";
    if (current !== output) {
      console.error(
        `Diagram schema drift: ${DIAGRAM_SCHEMA_OUTPUT_PATH} differs from the Zod source.\n` +
          `Run: bun run schema:gen:diagram   (then commit the result)`,
      );
      process.exit(1);
    }
    console.log("Diagram input schema is in sync with the Zod source.");
    process.exit(0);
  }

  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, output);
  console.log(`Generated ${DIAGRAM_SCHEMA_OUTPUT_PATH}`);
}
