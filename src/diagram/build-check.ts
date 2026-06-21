#!/usr/bin/env bun
/**
 * build-check.ts — drift guard for the committed CLI bundle (REQ-OUT-04/REQ-REPRO-01).
 *
 * Re-bundles src/diagram/cli.ts in memory with the SAME flags as `build:diagram`,
 * compares the bytes to the committed skills/diagram-generator/scripts/diagram-render.mjs,
 * and exits non-zero on drift. Mirrors src/schema-gen.ts --check (re-derive in memory,
 * diff committed bytes, exit non-zero on mismatch).
 *
 * STANDALONE script — NOT imported by cli.ts, so it never ships in the bundle.
 *
 * Usage:  bun run src/diagram/build-check.ts
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Committed bundle path (repo-relative); single committed copy. */
export const BUNDLE_OUTPUT_PATH = "skills/diagram-generator/scripts/diagram-render.mjs" as const;

/** Bundle entry; MUST match the `build:diagram` script (01 §5). */
const ENTRY = "src/diagram/cli.ts";

/**
 * Re-bundle the CLI in memory with the exact `build:diagram` flags
 * (--target=node --minify) and return the artifact text. Pure w.r.t. the
 * filesystem output — writes nothing; the committed file is the reference.
 */
export async function buildBundleText(repoRoot: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [resolve(repoRoot, ENTRY)],
    target: "node",
    minify: true,
  });
  if (!result.success) {
    console.error("build:diagram:check — in-memory bundle failed:");
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  // Single-entry build → single artifact.
  return await result.outputs[0]!.text();
}

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dirname, "../..");
  const abs = resolve(repoRoot, BUNDLE_OUTPUT_PATH);
  const fresh = await buildBundleText(repoRoot);
  const committed = existsSync(abs) ? readFileSync(abs, "utf-8") : "";
  if (committed !== fresh) {
    console.error(
      `Bundle drift: ${BUNDLE_OUTPUT_PATH} differs from a fresh build of ${ENTRY}.\n` +
        `Run: bun run build:diagram   (then commit the result)`,
    );
    process.exit(1);
  }
  console.log("Diagram CLI bundle is in sync with src/diagram/.");
  process.exit(0);
}
