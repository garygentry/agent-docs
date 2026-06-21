#!/usr/bin/env bun
/**
 * schema-gen.ts — JSON-Schema generation & drift guard for tools.manifest.json.
 *
 * Mirrors rauf's `scripts/generate-json-schemas.ts --check` pattern (02 §4): a pure
 * builder over the Zod `Manifest` source of truth plus a side-effectful CLI that either
 * WRITES the committed schema or, with `--check`, regenerates in memory and diffs against
 * the committed file (exit non-zero on drift). Satisfies REQ-DISC-03; wired into `gate`.
 *
 * Usage:
 *   bun run src/schema-gen.ts            # regenerate + write the committed schema
 *   bun run src/schema-gen.ts --check    # drift guard: fail if the committed copy is stale
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { Manifest } from "./model.js";

/** Committed JSON Schema output path (relative to repo root). Single committed copy. */
export const SCHEMA_OUTPUT_PATH = "schemas/tools.manifest.schema.json" as const;

/**
 * Build the manifest JSON Schema OBJECT from the Zod `Manifest` source of truth (00 §2.4).
 * Pure: no filesystem, no clock — safe to call from both the writer and the drift check,
 * guaranteeing the two compare identical values (REQ-DISC-03 / REQ-EMIT-06 spirit).
 *
 * Uses `$refStrategy: "none"` so the schema is fully inlined (matches rauf). Key order is
 * deterministic: zod-to-json-schema emits keys in a stable order for a fixed Zod input, and
 * the metadata keys ($schema/$id/title/description) are appended in fixed order — so two
 * calls yield byte-identical JSON when serialized.
 *
 * @returns The JSON Schema as a plain object.
 */
export function buildManifestSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(Manifest, { $refStrategy: "none" }) as Record<string, unknown>;
  schema["$schema"] = "http://json-schema.org/draft-07/schema#";
  schema["$id"] = "tools.manifest.schema.json";
  schema["title"] = "Agent-Docs Tool Manifest";
  schema["description"] =
    "Canonical tool registry + emitter config for the agent-agnostic scaffold (REQ-DISC-01/03).";
  return schema;
}

/**
 * Build the manifest JSON Schema TEXT: the object from {@link buildManifestSchema} serialized
 * as pretty-printed JSON (2-space indent) with a trailing newline so the committed file is
 * POSIX-clean and byte-stable. This is what gets written/diffed by the CLI.
 *
 * @returns The pretty-printed JSON Schema text (2-space indent, trailing newline).
 */
export function buildManifestSchemaJson(): string {
  return JSON.stringify(buildManifestSchema(), null, 2) + "\n";
}

// ─── CLI entry (side-effectful: skipped on import) ──────────────────

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dirname, "..");
  const check = process.argv.includes("--check");
  const output = buildManifestSchemaJson();
  const abs = resolve(repoRoot, SCHEMA_OUTPUT_PATH);

  if (check) {
    // Drift guard: regenerate in memory, diff against the committed file.
    const current = existsSync(abs) ? readFileSync(abs, "utf-8") : "";
    if (current !== output) {
      console.error(
        `Manifest schema drift: ${SCHEMA_OUTPUT_PATH} differs from the Zod source.\n` +
          `Run: bun run schema:gen   (then commit the result)`,
      );
      process.exit(1);
    }
    console.log("Manifest schema is in sync with the Zod source.");
    process.exit(0);
  }

  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, output);
  console.log(`Generated ${SCHEMA_OUTPUT_PATH}`);
}
