/**
 * Golden regeneration (08 §6.3) — DELIBERATE, reviewed step.
 *
 * Re-runs the real {@link emit} over the committed docs-helper sample source and
 * rewrites the byte-exact goldens under `src/test/__golden__/<target>/…` for the
 * sample-scoped relpaths pinned in `golden.test.ts` (`SAMPLE_RELPATHS`, 04 §6–§10).
 *
 * Goldens are NEVER auto-overwritten on a plain `vitest run` — an unintended
 * transform change surfaces as a failing `golden.test.ts` assertion (REQ-VALID-04).
 * Regenerate intentionally with:
 *
 *     bun run src/test/regenerate-goldens.ts
 *
 * then review the diff under `src/test/__golden__/` like any other source change.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { resolveConfig } from "../config.js";
import { emit } from "../emit.js";
import { loadManifest } from "../manifest.js";
import { GOLDEN_IDENTITY, GOLDEN_ROOT, REPO_ROOT, SAMPLE_RELPATHS } from "./golden.shared.js";

function main(): void {
  const manifest = loadManifest(path.join(REPO_ROOT, "tools.manifest.json"), REPO_ROOT);
  const roots = resolveConfig(manifest.config, REPO_ROOT);
  const result = emit(manifest, roots, GOLDEN_IDENTITY);

  const byPath = new Map(result.files.map((f) => [f.relpath, f.content] as const));
  let written = 0;
  for (const [target, relpaths] of Object.entries(SAMPLE_RELPATHS)) {
    for (const rel of relpaths) {
      const key = `${target}/${rel}`;
      const content = byPath.get(key);
      if (content === undefined) {
        throw new Error(`emit produced no file for pinned golden relpath: ${key}`);
      }
      const abs = path.join(GOLDEN_ROOT, target, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
      written++;
    }
  }
  console.log(`Regenerated ${written} golden file(s) under ${GOLDEN_ROOT}`);
}

main();
