/**
 * Cross-cutting drift / orphan guard (08 §5.2, SC-04, SC-05a, REQ-VALID-01).
 * Exercises driftCheck over a real published fixture tree: clean => no drift,
 * a hand-edited committed adapter => content entry, a removed tool => orphan.
 * Relpaths are derived from the emitted/removed set, never hardcoded.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { driftCheck } from "../driftguard.js";
import { DriftError } from "../errors.js";
import {
  buildAndPublish,
  cleanupFixtureRepo,
  makeFixtureRepo,
  type FixtureRepo,
} from "./__fixtures__/index.js";

let repos: FixtureRepo[] = [];
afterEach(() => {
  repos.forEach(cleanupFixtureRepo);
  repos = [];
});

/** Locate one committed adapter file path on disk for a target (post-publish). */
function anyAdapterFile(adaptersDir: string, target: string): string {
  const base = path.join(adaptersDir, target);
  const walk = (d: string): string[] =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  return walk(base)[0]!;
}

describe("drift guard — clean tree (SC-04)", () => {
  it("reports no drift on a freshly built tree", () => {
    const repo = makeFixtureRepo({ skills: ["sample"], commands: ["go"] });
    repos.push(repo);
    buildAndPublish(repo.manifest, repo.roots);
    expect(driftCheck(repo.manifest, repo.roots)).toEqual([]);
  });

  it("fails with kind:content when a committed adapter is hand-edited", () => {
    const repo = makeFixtureRepo({ skills: ["sample"] });
    repos.push(repo);
    buildAndPublish(repo.manifest, repo.roots);
    fs.appendFileSync(anyAdapterFile(repo.roots.adaptersDir, "cursor"), "\nhand edit\n");

    const drift = driftCheck(repo.manifest, repo.roots);
    expect(drift.some((d) => d.kind === "content")).toBe(true);
  });

  it("passes again once the edit is reverted (rebuild)", () => {
    const repo = makeFixtureRepo({ skills: ["sample"] });
    repos.push(repo);
    buildAndPublish(repo.manifest, repo.roots);
    fs.appendFileSync(anyAdapterFile(repo.roots.adaptersDir, "cursor"), "\nhand edit\n");
    buildAndPublish(repo.manifest, repo.roots); // re-publish overwrites the hand edit
    expect(driftCheck(repo.manifest, repo.roots)).toEqual([]);
  });
});

describe("orphan detection (SC-05a)", () => {
  it("flags a committed adapter with no canonical source as kind:orphan", () => {
    const repo = makeFixtureRepo({ skills: ["sample", "doomed"] });
    repos.push(repo);
    buildAndPublish(repo.manifest, repo.roots); // commits adapters for both skills
    // Remove "doomed" from the manifest but leave its committed adapters in place.
    repo.manifest.tools = repo.manifest.tools.filter((t) => t.name !== "doomed");

    const drift = driftCheck(repo.manifest, repo.roots);
    // Derive the expectation from the removed tool, not a hardcoded path.
    expect(drift.some((d) => d.kind === "orphan" && d.relpath.includes("doomed"))).toBe(true);
  });

  it("a rebuild removes the orphaned adapter files (stale cleanup, REQ-EMIT-08)", () => {
    const repo = makeFixtureRepo({ skills: ["sample", "doomed"] });
    repos.push(repo);
    buildAndPublish(repo.manifest, repo.roots);
    repo.manifest.tools = repo.manifest.tools.filter((t) => t.name !== "doomed");
    const overlay = buildAndPublish(repo.manifest, repo.roots); // atomic re-publish drops the subtree
    // Walk the freshly emitted set rather than asserting a hardcoded per-target path.
    expect(overlay.files.some((f) => f.relpath.includes("doomed"))).toBe(false);
    expect(driftCheck(repo.manifest, repo.roots)).toEqual([]); // no orphan drift remains
  });
});

describe("DriftError shape", () => {
  it("carries typed DriftEntry[] so the CLI can print which files and how", () => {
    const repo = makeFixtureRepo({ skills: ["sample"] });
    repos.push(repo);
    buildAndPublish(repo.manifest, repo.roots);
    fs.appendFileSync(anyAdapterFile(repo.roots.adaptersDir, "cursor"), "\nx\n");
    const drift = driftCheck(repo.manifest, repo.roots);
    const err = new DriftError("drift", drift);
    expect(err.code).toBe("DRIFT_DETECTED");
    expect(err.entries.length).toBeGreaterThan(0);
  });
});
