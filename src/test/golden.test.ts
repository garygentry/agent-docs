/**
 * Golden snapshot suite (08 §6, REQ-VALID-04, SC-02/SC-08).
 *
 * Emits the committed docs-helper sample (06 §5 scope — the one MVP sample skill,
 * NOT the whole tree) and asserts each target's output is byte-identical to the
 * checked-in goldens under `src/test/__golden__/<target>/…`. This is the focused
 * transform-regression test complementing the whole-tree drift guard (06 §5): a
 * transform change shows up as a tight, readable diff here.
 *
 * Comparison is BIDIRECTIONAL set equality on the sample-scoped, per-target relpaths
 * pinned in `golden.shared.ts` (04 §6–§10) — not `arrayContaining` / `.includes()`.
 * A newly emitted sample-scoped file with no golden counterpart (or a deleted one)
 * MUST fail (V-013).
 *
 * Regenerate goldens deliberately (08 §6.3): `bun run src/test/regenerate-goldens.ts`,
 * then review the diff under `src/test/__golden__/`. Goldens never auto-update on a
 * plain `vitest run`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { resolveConfig } from "../config.js";
import { emit } from "../emit.js";
import { loadManifest } from "../manifest.js";
import { TARGET_ORDER, type EmitResult, type Target } from "../model.js";
import { GOLDEN_IDENTITY, GOLDEN_ROOT, REPO_ROOT, SAMPLE_RELPATHS } from "./golden.shared.js";

/** Read every golden file for a target as bundle-relative relpath → content. */
function readGolden(target: Target): Map<string, string> {
  const base = path.join(GOLDEN_ROOT, target);
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else
        out.set(path.relative(base, abs).split(path.sep).join("/"), fs.readFileSync(abs, "utf8"));
    }
  };
  walk(base);
  return out;
}

describe("golden snapshot — docs-helper sample (SC-02, REQ-VALID-04)", () => {
  let result: EmitResult;

  beforeAll(() => {
    const manifest = loadManifest(path.join(REPO_ROOT, "tools.manifest.json"), REPO_ROOT);
    const roots = resolveConfig(manifest.config, REPO_ROOT);
    result = emit(manifest, roots, GOLDEN_IDENTITY);
  });

  for (const target of TARGET_ORDER) {
    it(`emits ${target} byte-identical to the golden`, () => {
      // Select emitted files by the EXACT pinned per-target relpaths (04 §6–§10),
      // not by extension/substring heuristics.
      const wanted = new Set(SAMPLE_RELPATHS[target]);
      const emitted = new Map(
        result.files
          .filter((f) => f.relpath.startsWith(`${target}/`))
          .map((f) => [f.relpath.slice(target.length + 1), f.content] as const)
          .filter(([rel]) => wanted.has(rel)),
      );

      const golden = readGolden(target);

      // Byte-exact content for every golden file.
      for (const [rel, content] of golden) {
        expect(emitted.get(rel), `missing/changed: ${target}/${rel}`).toBe(content);
      }

      // Bidirectional set equality (V-013): emitted sample-scoped keys MUST equal the
      // golden keys exactly — a new unreviewed emitted file fails, a removed one fails.
      expect([...emitted.keys()].sort()).toEqual([...golden.keys()].sort());
      // And the goldens cover exactly the pinned relpaths (no orphaned golden files).
      expect([...golden.keys()].sort()).toEqual([...wanted].sort());
    });
  }
});
