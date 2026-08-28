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

import { type ScaffoldAnswers, loadAnswers, readGoldenTree } from "./doc-site-scaffold.shared.js";
import {
  COEXIST_SEQUENTIAL,
  PROVENANCE_PATH,
  buildCoexistSequential,
  finalScaffold,
  finalScaffoldOnto,
  mergeProvenance,
} from "./doc-site-final-scaffold.shared.js";

const PROVENANCE = PROVENANCE_PATH;

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

// The rerun.md §1.4 cross-renderer merge the second run performs on the shared repo-root
// provenance (union `files`, PRESERVE the other renderer's pins, take the current run's
// `version`) is `mergeProvenance`, imported from the scaffold model so the test and the
// golden regenerator pin one source of truth.

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

/**
 * The on-disk materialization of the above: `renderer=both` realized as two sequential
 * distinct-dir runs (Starlight → `docs/`, then Mintlify → `docs-mintlify/`) over one
 * shared `docs-src/` content source, committed as a single golden tree. The prior three
 * tests model the merge in memory; this one pins the merged tree byte-for-byte and proves
 * a re-run of either renderer is a no-op (rerun.md §1.4 + §3).
 */
describe("renderer coexistence — sequential golden (rerun.md §1.4)", () => {
  const golden = readGoldenTree(COEXIST_SEQUENTIAL.golden);
  const starlight = loadAnswers(COEXIST_SEQUENTIAL.first); // → docs/ (first run)
  const mintlify = loadAnswers(COEXIST_SEQUENTIAL.second); // → docs-mintlify/ (second run)

  it("the two-run merged tree is byte-identical to its committed golden", () => {
    const resolved = buildCoexistSequential();
    for (const [rel, content] of golden) {
      expect(resolved.get(rel), `missing/changed: ${COEXIST_SEQUENTIAL.golden}/${rel}`).toBe(
        content,
      );
    }
    expect([...resolved.keys()].sort()).toEqual([...golden.keys()].sort());
  });

  it("no unresolved {{TOKEN}} survives in the merged tree", () => {
    for (const [rel, content] of golden) {
      expect(/\{\{[A-Z0-9_]+\}\}/.test(content), `unresolved token in ${rel}`).toBe(false);
    }
  });

  it("one provenance manifest carries BOTH containers' managed files plus the Starlight pins", () => {
    const prov = provenanceOf(golden);
    const paths = Object.keys(prov.files);
    expect(paths.some((p) => p.startsWith("docs/"))).toBe(true);
    expect(paths.some((p) => p.startsWith("docs-mintlify/"))).toBe(true);
    // The Starlight run's pins are preserved; the Mintlify run adds none of its own.
    expect(prov.astroPin).toBe(starlight.tokens.ASTRO_VERSION);
    expect(prov.starlightPin).toBe(starlight.tokens.STARLIGHT_VERSION);
    // Distinct dirs ⇒ the containers never collide (only the manifest is shared).
    const both = [...golden.keys()].filter((p) => p !== PROVENANCE);
    expect(both.every((p) => p.startsWith("docs/") || p.startsWith("docs-mintlify/"))).toBe(true);
  });

  it("re-running EITHER renderer over the merged tree is a no-op diff (§3)", () => {
    // Re-run Starlight: its docs/ plumbing REGENERATEs to identical bytes; docs-mintlify/
    // is untouched; the shared manifest merges back to itself.
    expect([...finalScaffoldOnto(golden, starlight).entries()].sort()).toEqual(
      [...golden.entries()].sort(),
    );
    // Re-run Mintlify: symmetrically a no-op, and it preserves the Starlight pins.
    expect([...finalScaffoldOnto(golden, mintlify).entries()].sort()).toEqual(
      [...golden.entries()].sort(),
    );
  });
});
