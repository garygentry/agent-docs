/**
 * Renderer coexistence (rerun.md §1.4): two renderers can share one repo by running
 * the skill twice — once per renderer — into two DISTINCT {{DOCS_PKG_DIR}}s. This is
 * how `renderer=both` is realized; there is no dual-emit mode.
 *
 * These tests pin the assessment behind that design:
 *  - Same directory ⇒ the two containers COLLIDE on package.json / .gitignore (and, in
 *    symlink mode, setup-docs.sh). That hazard is why detect.md Probe 8 refuses a
 *    same-dir second renderer (SAME_DIR_RENDERER_CONFLICT).
 *  - Distinct directories ⇒ the emitted file sets are DISJOINT except the shared
 *    repo-root provenance manifest (which merges, §1.4). So sequential runs never
 *    clobber each other.
 */
import { describe, expect, it } from "vitest";

import { type ScaffoldAnswers, loadAnswers } from "./doc-site-scaffold.shared.js";
import { finalScaffold } from "./doc-site-final-scaffold.shared.js";

const PROVENANCE = ".doc-site-scaffold.json";

/** Path keys emitted to both trees (a collision surface). */
function sharedPaths(a: Map<string, string>, b: Map<string, string>): string[] {
  return [...a.keys()].filter((p) => b.has(p)).sort();
}

/** Re-root a Mintlify answer set into a different docs package directory. */
function intoDir(answers: ScaffoldAnswers, dir: string): ScaffoldAnswers {
  return { ...answers, tokens: { ...answers.tokens, DOCS_PKG_DIR: dir } };
}

describe("renderer coexistence (rerun.md §1.4)", () => {
  const starlight = finalScaffold(loadAnswers("decline-all.json")); // → docs/
  const mintlifyNative = loadAnswers("mintlify-native.json"); // → docs/

  it("same directory collides on package.json and .gitignore (why Probe 8 refuses it)", () => {
    const mintlifySameDir = finalScaffold(mintlifyNative); // also → docs/
    const shared = sharedPaths(starlight, mintlifySameDir);
    // The clobber surface the same-dir guard prevents:
    expect(shared).toContain("docs/package.json");
    expect(shared).toContain("docs/.gitignore");
    // …and those really are different bytes (a genuine clobber, not a coincidence).
    expect(starlight.get("docs/package.json")).not.toBe(mintlifySameDir.get("docs/package.json"));
    expect(starlight.get("docs/.gitignore")).not.toBe(mintlifySameDir.get("docs/.gitignore"));
  });

  it("distinct directories are clobber-free apart from the shared provenance manifest", () => {
    const mintlifyOtherDir = finalScaffold(intoDir(mintlifyNative, "docs-mintlify")); // → docs-mintlify/
    const shared = sharedPaths(starlight, mintlifyOtherDir);
    // The ONLY shared path is the repo-root provenance (which merges, §1.4).
    expect(shared).toEqual([PROVENANCE]);
    // Every Mintlify file lands under its own dir; no docs/ path is touched.
    for (const p of mintlifyOtherDir.keys()) {
      if (p === PROVENANCE) continue;
      expect(p.startsWith("docs-mintlify/")).toBe(true);
    }
  });
});
