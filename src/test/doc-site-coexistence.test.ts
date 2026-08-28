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

interface Provenance {
  version: string;
  astroPin?: string;
  starlightPin?: string;
  diagramContract?: string;
  files: Record<string, string>;
}

const provenanceOf = (tree: Map<string, string>): Provenance =>
  JSON.parse(tree.get(PROVENANCE)!) as Provenance;

/**
 * The rerun.md §1.4 cross-renderer merge the second run performs on the shared
 * repo-root provenance: union `files`, PRESERVE the other renderer's pins, take the
 * current run's `version`. Modeled here (agent behavior, no runtime module) to pin the
 * documented semantics.
 */
function mergeProvenance(existing: Provenance, current: Provenance): Provenance {
  const merged: Provenance = {
    version: current.version,
    files: { ...existing.files, ...current.files },
  };
  const astroPin = existing.astroPin ?? current.astroPin;
  const starlightPin = existing.starlightPin ?? current.starlightPin;
  const diagramContract = current.diagramContract ?? existing.diagramContract;
  if (astroPin !== undefined) merged.astroPin = astroPin;
  if (starlightPin !== undefined) merged.starlightPin = starlightPin;
  if (diagramContract !== undefined) merged.diagramContract = diagramContract;
  return merged;
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

  it("the second run merges the shared provenance (union files, preserve pins)", () => {
    const first = provenanceOf(starlight); // Starlight into docs/ (carries astro/starlight pins)
    const second = provenanceOf(finalScaffold(intoDir(mintlifyNative, "docs-mintlify")));
    const merged = mergeProvenance(first, second);

    // Both renderers' managed files survive under their distinct paths.
    expect(Object.keys(merged.files).some((p) => p.startsWith("docs/"))).toBe(true);
    expect(Object.keys(merged.files).some((p) => p.startsWith("docs-mintlify/"))).toBe(true);
    // No first-run entry is dropped or altered by the merge.
    for (const [p, hash] of Object.entries(first.files)) {
      expect(merged.files[p]).toBe(hash);
    }
    // The Mintlify run preserves the Starlight pins (it adds none of its own).
    expect(merged.astroPin).toBe(first.astroPin);
    expect(merged.starlightPin).toBe(first.starlightPin);
    expect(second.astroPin).toBeUndefined();
  });
});
