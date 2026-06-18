import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { discover } from "./discover.js";
import { resolveConfig } from "./config.js";
import { Manifest } from "./model.js";
import { PathEscapeError } from "./errors.js";

const repos: string[] = [];

afterEach(() => {
  for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** Build a fixture repo with a skill (+ own refs/scripts), an agent, a command,
 *  and shared references/scripts. Returns { root, manifest, roots }. */
function makeFixtureRepo() {
  const root = mkdtempSync(join(tmpdir(), "discover-"));
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
  - Write
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

describe("discover", () => {
  it("parses skill/agent/command into typed records", () => {
    const { manifest, roots } = makeFixtureRepo();
    const result = discover(manifest, roots);

    expect(result.skills).toHaveLength(1);
    expect(result.agents).toHaveLength(1);
    expect(result.commands).toHaveLength(1);

    const skill = result.skills[0]!;
    expect(skill.name).toBe("docs-helper");
    expect(skill.description).toBe("Helps with docs.");
    expect(skill.sourcePath).toBe("skills/docs-helper/SKILL.md");
    expect(skill.body).toContain("Body of the skill.");

    const agent = result.agents[0]!;
    expect(agent.name).toBe("doc-reviewer");
    expect([...agent.claudeKeys.keys()]).toEqual(["tools", "model"]);
    expect(agent.claudeKeys.has("name")).toBe(false);
    expect(agent.body).toContain("System prompt");

    const command = result.commands[0]!;
    expect(command.name).toBe("summarize");
    expect(command.argumentHint).toBe("[path]");
    expect(command.body).toContain("Summarize the document");
  });

  it("nests extra skill frontmatter under metadata, excluding name/description (TQ-3)", () => {
    const { manifest, roots } = makeFixtureRepo();
    const skill = discover(manifest, roots).skills[0]!;

    expect([...skill.metadata.keys()]).toEqual(["argument-hint", "allowed-tools"]);
    expect(skill.metadata.has("name")).toBe(false);
    expect(skill.metadata.has("description")).toBe(false);
    expect(skill.metadata.get("argument-hint")).toBe("[topic]");
    expect(skill.metadata.get("allowed-tools")).toEqual(["Read", "Write"]);
  });

  it("collects skill-owned refs and shared references/scripts", () => {
    const { manifest, roots } = makeFixtureRepo();
    const result = discover(manifest, roots);

    expect(result.skills[0]!.ownRefs).toEqual([
      "skills/docs-helper/references/style.md",
      "skills/docs-helper/scripts/run.sh",
    ]);

    expect(result.sharedRefs).toEqual([{ sourcePath: "references/shared.md", mode: 0o644 }]);
    expect(result.sharedScripts).toEqual([{ sourcePath: "scripts/shared.sh", mode: 0o755 }]);
  });

  it("produces deterministic ordering across two runs regardless of manifest order", () => {
    const { manifest, roots } = makeFixtureRepo();
    const first = discover(manifest, roots);

    const shuffled = Manifest.parse({
      version: 1,
      tools: [...manifest.tools].reverse(),
    });
    const second = discover(shuffled, roots);

    expect(second.skills.map((s) => s.sourcePath)).toEqual(
      first.skills.map((s) => s.sourcePath),
    );
    expect(second.agents.map((a) => a.sourcePath)).toEqual(
      first.agents.map((a) => a.sourcePath),
    );
    expect(second.commands.map((c) => c.sourcePath)).toEqual(
      first.commands.map((c) => c.sourcePath),
    );
    expect(second.sharedRefs).toEqual(first.sharedRefs);
    expect(second.sharedScripts).toEqual(first.sharedScripts);
  });

  it("throws PathEscapeError for a source that escapes the repo root", () => {
    const { root, roots } = makeFixtureRepo();
    const manifest = Manifest.parse({
      version: 1,
      tools: [{ name: "evil", type: "command", source: "../escape.md" }],
    });
    void root;
    expect(() => discover(manifest, roots)).toThrow(PathEscapeError);
  });
});
