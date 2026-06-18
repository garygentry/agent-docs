/**
 * Determinism / idempotency (08 §5.1, SC-03, REQ-EMIT-05/06). Two load-bearing
 * properties: emit twice -> zero diff, and build then driftCheck -> clean. The
 * fixture includes a command tool so smol-toml serialization (codex agent `.toml`,
 * gemini command `.toml`) is exercised, not just YAML/markdown.
 */

import { afterEach, describe, expect, it } from "vitest";

import { driftCheck } from "../driftguard.js";
import { emit } from "../emit.js";
import type { EmittedFile } from "../model.js";
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

/** Snapshot every emitted file's path+content as a sortable string. */
function snapshot(files: EmittedFile[]): string {
  return [...files]
    .sort((a, b) => (a.relpath < b.relpath ? -1 : a.relpath > b.relpath ? 1 : 0))
    .map((f) => `${f.relpath}\n${f.content}`)
    .join("\n--FILE--\n");
}

describe("determinism (SC-03)", () => {
  it("two emits over unchanged input produce byte-identical output", () => {
    // The command tool is REQUIRED: it forces TOML serialization (codex agent
    // `.toml`, gemini command `.toml`), exercising smol-toml's key ordering.
    const repo = makeFixtureRepo({ skills: ["sample"], agents: ["helper"], commands: ["go"] });
    repos.push(repo);
    const a = emit(repo.manifest, repo.roots);
    const b = emit(repo.manifest, repo.roots);
    expect(snapshot(b.files)).toBe(snapshot(a.files));
  });

  it("re-emits TOML constructs byte-identically (smol-toml key order)", () => {
    // A command emits TOML on gemini (commands/<n>.toml); an agent emits TOML on
    // codex (agents/<n>.toml). Assert the TOML files specifically are byte-stable.
    const repo = makeFixtureRepo({ agents: ["helper"], commands: ["go"] });
    repos.push(repo);
    const a = emit(repo.manifest, repo.roots).files.filter((f) => f.relpath.endsWith(".toml"));
    const b = emit(repo.manifest, repo.roots).files.filter((f) => f.relpath.endsWith(".toml"));
    expect(a.length).toBeGreaterThan(0); // TOML is actually exercised
    expect(snapshot(b)).toBe(snapshot(a));
  });

  it("publish is idempotent — a second build-then-driftCheck reports no drift", () => {
    const repo = makeFixtureRepo({ skills: ["sample"], agents: ["helper"], commands: ["go"] });
    repos.push(repo);
    // emit is in-memory; buildAndPublish writes adapters/ so driftCheck has a
    // committed tree to diff against (05 §1, §4).
    buildAndPublish(repo.manifest, repo.roots);
    buildAndPublish(repo.manifest, repo.roots); // re-publishing identical input is a no-op
    expect(driftCheck(repo.manifest, repo.roots)).toEqual([]);
  });
});
