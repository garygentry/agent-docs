import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveConfig } from "../config.js";
import { emit } from "../emit.js";
import { Manifest, TARGET_ORDER } from "../model.js";

const repos: string[] = [];

afterEach(() => {
  for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
});

/**
 * Build a minimal fixture repo with one skill (+ owned ref/script), one agent,
 * one command, and a shared references/scripts tree. Returns { manifest, roots }.
 */
function makeFixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), "emit-"));
  repos.push(root);

  const write = (rel: string, content: string) => {
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
allowed-tools:
  - Read
---
Body of the skill.
`,
  );
  write("skills/docs-helper/references/style.md", "# Style guide\n");
  write("skills/docs-helper/scripts/run.sh", "#!/bin/sh\necho hi\n");

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

const IDENTITY = { name: "fixture-plugin", version: "1.2.3" };

describe("emit", () => {
  it("aggregates files for all five targets in TARGET_ORDER", () => {
    const { manifest, roots } = makeFixtureRepo();
    const result = emit(manifest, roots, IDENTITY);

    // Every target produced at least one file, and all relpaths are
    // adapter-root-relative (`<target>/...`).
    for (const target of TARGET_ORDER) {
      const targetFiles = result.files.filter((f) => f.relpath.startsWith(`${target}/`));
      expect(targetFiles.length).toBeGreaterThan(0);
    }
    // No file escapes the five known bundles.
    for (const f of result.files) {
      expect(TARGET_ORDER.some((t) => f.relpath.startsWith(`${t}/`))).toBe(true);
    }
  });

  it("emits the expected canonical claude relpaths with no claude drops", () => {
    const { manifest, roots } = makeFixtureRepo();
    const result = emit(manifest, roots, IDENTITY);

    const claudePaths = result.files
      .map((f) => f.relpath)
      .filter((p) => p.startsWith("claude/"))
      .sort();
    expect(claudePaths).toEqual([
      "claude/agents/doc-reviewer.md",
      "claude/commands/summarize.md",
      "claude/skills/docs-helper/SKILL.md",
    ]);

    expect(result.drops.filter((d) => d.target === "claude")).toEqual([]);
  });

  it("emits the codex and gemini aggregate manifests with threaded identity", () => {
    const { manifest, roots } = makeFixtureRepo();
    const result = emit(manifest, roots, IDENTITY);

    const relpaths = new Set(result.files.map((f) => f.relpath));
    expect(relpaths.has("codex/agents/openai.yaml")).toBe(true);
    expect(relpaths.has("gemini/gemini-extension.json")).toBe(true);

    const geminiExt = result.files.find((f) => f.relpath === "gemini/gemini-extension.json")!;
    expect(geminiExt.content).toContain("fixture-plugin");
    expect(geminiExt.content).toContain("1.2.3");
  });

  it("records expected drops on non-claude targets", () => {
    const { manifest, roots } = makeFixtureRepo();
    const result = emit(manifest, roots, IDENTITY);

    // The command argument-hint has no native representation on codex/gemini/etc,
    // so every non-claude target records at least one drop.
    for (const target of TARGET_ORDER.filter((t) => t !== "claude")) {
      expect(result.drops.some((d) => d.target === target)).toBe(true);
    }
  });

  it("declares verbatim copies for skill-owned and shared refs/scripts per target", () => {
    const { manifest, roots } = makeFixtureRepo();
    const result = emit(manifest, roots, IDENTITY);

    // Skill-owned ref lands beside the skill on claude; shared trees land flat.
    const claudeVerbatim = result.verbatim
      .filter((v) => v.relpath.startsWith("claude/"))
      .map((v) => v.relpath)
      .sort();
    expect(claudeVerbatim).toContain("claude/skills/docs-helper/references/style.md");
    expect(claudeVerbatim).toContain("claude/references/shared.md");
    expect(claudeVerbatim).toContain("claude/scripts/shared.sh");

    // Cursor flattens the skill ref under a sibling rules/<n>/ directory.
    const cursorRefs = result.verbatim
      .filter((v) => v.relpath.startsWith("cursor/"))
      .map((v) => v.relpath);
    expect(cursorRefs).toContain("cursor/rules/docs-helper/references/style.md");
  });

  it("is pure: writes no overrides and is byte-stable across two runs", () => {
    const { manifest, roots } = makeFixtureRepo();
    const a = emit(manifest, roots, IDENTITY);
    const b = emit(manifest, roots, IDENTITY);

    expect(a.overridden).toEqual([]);
    expect(JSON.stringify(a.files)).toEqual(JSON.stringify(b.files));
    expect(JSON.stringify(a.drops)).toEqual(JSON.stringify(b.drops));
    expect(JSON.stringify(a.verbatim)).toEqual(JSON.stringify(b.verbatim));
  });
});
