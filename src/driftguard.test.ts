import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveConfig } from "./config.js";
import type { ResolvedRoots } from "./config.js";
import { DriftError } from "./errors.js";
import { driftCheck, assertNoDrift } from "./driftguard.js";
import { emit } from "./emit.js";
import { applyOverrides, loadOverrides } from "./overrides.js";
import { Manifest } from "./model.js";
import { publish } from "./publish.js";

const repos: string[] = [];

afterEach(() => {
  for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** Author a fixture repo (skill + agent + command + shared refs/scripts). */
function makeFixtureRepo(): { root: string; manifest: Manifest; roots: ResolvedRoots } {
  const root = mkdtempSync(join(tmpdir(), "driftguard-"));
  repos.push(root);

  const write = (rel: string, content: string): void => {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  };

  write(
    "skills/docs-helper/SKILL.md",
    `---
name: docs-helper
description: Helps with docs.
argument-hint: "[topic]"
---
Body of the skill.
`,
  );
  write("skills/docs-helper/references/style.md", "# Style guide\n");

  write(
    "agents/doc-reviewer.md",
    `---
name: doc-reviewer
description: Reviews docs.
tools:
  - Read
model: opus
---
System prompt for the reviewer.
`,
  );

  write(
    "commands/summarize.md",
    `---
name: summarize
description: Summarize the current document.
argument-hint: "[path]"
---
Summarize the document at the given path...
`,
  );

  write("references/shared.md", "# Shared reference\n");
  write("scripts/shared.sh", "#!/bin/sh\necho shared\n");

  const manifest = Manifest.parse({
    version: 1,
    tools: [
      { name: "docs-helper", type: "skill", source: "skills/docs-helper/SKILL.md" },
      { name: "doc-reviewer", type: "agent", source: "agents/doc-reviewer.md" },
      { name: "summarize", type: "command", source: "commands/summarize.md" },
    ],
  });
  const roots = resolveConfig(manifest.config, root);
  return { root, manifest, roots };
}

/** Emit → overlay → publish the full tree, matching a normal build (05 §1). */
function buildAndPublish(manifest: Manifest, roots: ResolvedRoots): void {
  const result = emit(manifest, roots);
  const overrides = loadOverrides(roots, manifest.config.targets);
  const { files } = applyOverrides(result.files, overrides);
  publish(files, result.verbatim, roots);
}

describe("driftCheck", () => {
  it("returns zero entries for a clean, freshly-built tree (SC-03)", () => {
    const { manifest, roots } = makeFixtureRepo();
    buildAndPublish(manifest, roots);

    expect(driftCheck(manifest, roots)).toEqual([]);
    expect(() => assertNoDrift(manifest, roots)).not.toThrow();
  });

  it("flags a hand-edited committed file as content drift (SC-04)", () => {
    const { manifest, roots } = makeFixtureRepo();
    buildAndPublish(manifest, roots);

    const target = join(roots.adaptersDir, "claude/skills/docs-helper/SKILL.md");
    writeFileSync(target, readFileSync(target, "utf8") + "\nhand-edited\n");

    const entries = driftCheck(manifest, roots);
    expect(entries).toEqual([
      { relpath: "claude/skills/docs-helper/SKILL.md", kind: "content" },
    ]);

    expect(() => assertNoDrift(manifest, roots)).toThrow(DriftError);
  });

  it("flags a committed file with no emitted counterpart as an orphan (REQ-EMIT-08, SC-05a)", () => {
    const { manifest, roots } = makeFixtureRepo();
    buildAndPublish(manifest, roots);

    // A stale adapter file left by a removed/renamed tool.
    const orphan = join(roots.adaptersDir, "claude/skills/ghost/SKILL.md");
    mkdirSync(join(orphan, ".."), { recursive: true });
    writeFileSync(orphan, "# ghost\n");

    const entries = driftCheck(manifest, roots);
    expect(entries).toContainEqual({
      relpath: "claude/skills/ghost/SKILL.md",
      kind: "orphan",
    });
    expect(entries.every((e) => e.kind === "orphan")).toBe(true);
  });

  it("flags an emitted file absent from the committed tree as missing", () => {
    const { manifest, roots } = makeFixtureRepo();
    buildAndPublish(manifest, roots);

    // Delete a committed adapter file the build still emits.
    rmSync(join(roots.adaptersDir, "claude/skills/docs-helper/SKILL.md"));

    const entries = driftCheck(manifest, roots);
    expect(entries).toContainEqual({
      relpath: "claude/skills/docs-helper/SKILL.md",
      kind: "missing",
    });
    expect(entries.every((e) => e.kind === "missing")).toBe(true);
  });

  it("re-applies the override overlay so a legitimate override never reads as drift (REQ-VALID-01)", () => {
    const { manifest, roots } = makeFixtureRepo();
    // Author an override that replaces an emitted file whole.
    const ovPath = join(roots.overridesDir, "claude/skills/docs-helper/SKILL.md");
    mkdirSync(join(ovPath, ".."), { recursive: true });
    writeFileSync(ovPath, "# entirely author-owned\n");

    buildAndPublish(manifest, roots);

    expect(driftCheck(manifest, roots)).toEqual([]);
  });

  it("covers the repo-root .claude-plugin/ tree (orphan when uncommitted-by-build)", () => {
    const { manifest, roots } = makeFixtureRepo();
    buildAndPublish(manifest, roots);

    // A committed .claude-plugin manifest with no emitted counterpart (no plugin
    // files threaded in) surfaces as an orphan — proving the guard walks that root.
    const pluginJson = join(roots.repoRoot, ".claude-plugin/plugin.json");
    mkdirSync(join(pluginJson, ".."), { recursive: true });
    writeFileSync(pluginJson, "{}\n");

    const entries = driftCheck(manifest, roots);
    expect(entries).toContainEqual({ relpath: ".claude-plugin/plugin.json", kind: "orphan" });

    // When the build's plugin files are threaded in, the same committed file matches.
    const clean = driftCheck(manifest, roots, [
      { relpath: ".claude-plugin/plugin.json", content: "{}\n", mode: 0o644 },
    ]);
    expect(clean).toEqual([]);
  });
});

describe("renderDriftMessage via DriftError", () => {
  it("lists each file with its kind and a single remediation line (REQ-OBS-02)", () => {
    const { manifest, roots } = makeFixtureRepo();
    buildAndPublish(manifest, roots);
    writeFileSync(
      join(roots.adaptersDir, "claude/skills/docs-helper/SKILL.md"),
      "mutated\n",
    );

    try {
      assertNoDrift(manifest, roots);
      throw new Error("expected DriftError");
    } catch (err) {
      expect(err).toBeInstanceOf(DriftError);
      const msg = (err as DriftError).message;
      expect(msg).toContain("Adapter drift detected");
      expect(msg).toContain("claude/skills/docs-helper/SKILL.md");
      expect(msg).toContain("Remediation: run `bun run build`");
    }
  });
});
