/**
 * Scaffold-golden regeneration (10 §5.3) — DELIBERATE, reviewed step. Mirrors
 * src/test/regenerate-goldens.ts. Resolves every answer set in 10 §5.1 via the SAME
 * `finalScaffold` the test uses and rewrites src/test/__scaffold_golden__/<set>/ as
 * a REAL target-path tree (10 §7).
 *
 * Goldens are NEVER auto-overwritten on a plain `vitest run`; an unintended template
 * or token change surfaces as a failing doc-site-scaffold.test.ts assertion. Run:
 *
 *     bun run src/test/regenerate-scaffold-goldens.ts
 *
 * then review the diff under src/test/__scaffold_golden__/ like any other source
 * change. No Astro build, diagram render, or network call occurs here (10 §2).
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { ANSWER_SETS, SCAFFOLD_GOLDEN_DIR, loadAnswers } from "./doc-site-scaffold.shared.js";
import {
  COEXIST_SEQUENTIAL,
  buildCoexistSequential,
  finalScaffold,
  loadPreexisting,
} from "./doc-site-final-scaffold.shared.js";

/** Write a resolved target tree under __scaffold_golden__/<name>/, starting clean. */
function writeGolden(name: string, tree: Map<string, string>): number {
  const base = path.join(SCAFFOLD_GOLDEN_DIR, name);
  // Start each set from a clean tree so removed templates don't leave stale goldens.
  fs.rmSync(base, { recursive: true, force: true });
  for (const [rel, content] of tree) {
    const abs = path.join(base, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return tree.size;
}

function main(): void {
  let written = 0;
  for (const name of ANSWER_SETS) {
    written += writeGolden(name, finalScaffold(loadAnswers(`${name}.json`), loadPreexisting(name)));
  }
  // The renderer=both sequential coexistence golden (rerun.md §1.4): two distinct-dir
  // single-renderer runs over one shared content source, merged into one manifest.
  written += writeGolden(COEXIST_SEQUENTIAL.golden, buildCoexistSequential());
  console.log(`Regenerated ${written} scaffold-golden file(s) under ${SCAFFOLD_GOLDEN_DIR}`);
}

main();
