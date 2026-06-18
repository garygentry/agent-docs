import { describe, it, expect } from "vitest";
import { claudeTransform } from "./claude.js";
import { orderFrontmatter, skillVerbatimRecords } from "./_shared.js";
import { TRANSFORMS } from "./index.js";
import { PROVENANCE } from "../model.js";
import type { AgentRecord, CommandRecord, SkillRecord } from "../model.js";

/** A canonical skill with the TQ-3 nested `metadata` shape (03 §4). */
function makeSkill(): SkillRecord {
  return {
    name: "docs-helper",
    description: "Help with docs.",
    metadata: new Map<string, unknown>([
      [
        "metadata",
        new Map<string, unknown>([
          ["argument-hint", "[topic]"],
          ["allowed-tools", ["Read", "Grep"]],
        ]),
      ],
    ]),
    body: "Skill body line.\n",
    ownRefs: ["skills/docs-helper/references/style.md"],
    sourcePath: "skills/docs-helper/SKILL.md",
  };
}

function makeAgent(): AgentRecord {
  return {
    name: "doc-reviewer",
    description: "Reviews docs.",
    claudeKeys: new Map<string, unknown>([
      ["tools", ["Read", "Grep"]],
      ["model", "opus"],
    ]),
    body: "Agent body.\n",
    sourcePath: "agents/doc-reviewer.md",
  };
}

function makeCommand(): CommandRecord {
  return {
    name: "summarize",
    description: "Summarize a document.",
    argumentHint: "[path]",
    body: "Summarize the document.\n",
    sourcePath: "commands/summarize.md",
  };
}

describe("claudeTransform (04 §6) — canonical, no drops", () => {
  it("is registered under the claude key with target=claude", () => {
    expect(TRANSFORMS.claude).toBe(claudeTransform);
    expect(claudeTransform.target).toBe("claude");
  });

  it("transformSkill emits skills/<n>/SKILL.md with Form A provenance and no drops", () => {
    const out = claudeTransform.transformSkill(makeSkill());
    expect(out.drops).toEqual([]);
    expect(out.manifestEntries).toEqual([]);
    expect(out.files).toHaveLength(1);
    const file = out.files[0]!;
    expect(file.relpath).toBe("skills/docs-helper/SKILL.md");
    expect(file.mode).toBe(0o644);
    // Form A: provenance is the first line INSIDE the `---` fences.
    expect(file.content.startsWith(`---\n${PROVENANCE.yamlComment("skills/docs-helper/SKILL.md")}\n`)).toBe(
      true,
    );
    // argument-hint surfaced to top level; metadata mapping retained; body preserved.
    expect(file.content).toContain("argument-hint: \"[topic]\"");
    expect(file.content).toContain("metadata:");
    expect(file.content).toContain("allowed-tools:");
    expect(file.content.endsWith("Skill body line.\n")).toBe(true);
  });

  it("transformAgent emits agents/<n>.md with ALL claudeKeys and no drops", () => {
    const out = claudeTransform.transformAgent(makeAgent());
    expect(out.drops).toEqual([]);
    expect(out.files[0]!.relpath).toBe("agents/doc-reviewer.md");
    expect(out.files[0]!.content).toContain("tools:");
    expect(out.files[0]!.content).toContain("model: opus");
  });

  it("transformCommand emits commands/<n>.md with argument-hint and no drops", () => {
    const out = claudeTransform.transformCommand(makeCommand());
    expect(out.drops).toEqual([]);
    expect(out.files[0]!.relpath).toBe("commands/summarize.md");
    expect(out.files[0]!.content).toContain("argument-hint: \"[path]\"");
  });

  it("produces zero DropRecords across skill/agent/command (REQ-EMIT-07, CON-03)", () => {
    const all = [
      claudeTransform.transformSkill(makeSkill()),
      claudeTransform.transformAgent(makeAgent()),
      claudeTransform.transformCommand(makeCommand()),
    ];
    expect(all.flatMap((o) => o.drops)).toEqual([]);
  });

  it("is byte-identical across two transforms (REQ-EMIT-06)", () => {
    expect(claudeTransform.transformSkill(makeSkill()).files[0]!.content).toBe(
      claudeTransform.transformSkill(makeSkill()).files[0]!.content,
    );
  });

  it("aggregateManifest returns null (no claude aggregate)", () => {
    expect(claudeTransform.aggregateManifest([], { name: "x", version: "1" })).toBeNull();
  });
});

describe("_shared helpers", () => {
  it("orderFrontmatter sorts by KEY_ORDER then appends leftover keys", () => {
    const ordered = orderFrontmatter(
      new Map<string, unknown>([
        ["custom", 1],
        ["description", "d"],
        ["name", "n"],
      ]),
    );
    expect([...ordered.keys()]).toEqual(["name", "description", "custom"]);
  });

  it("skillVerbatimRecords maps ownRefs to the per-target skill dir", () => {
    const skill = makeSkill();
    expect(skillVerbatimRecords(skill, "claude")).toEqual([
      { relpath: "skills/docs-helper/references/style.md", sourcePath: "skills/docs-helper/references/style.md" },
    ]);
    // cursor uses the flattened sibling dir rules/<n>/<ref-subpath> (04 §4.6).
    expect(skillVerbatimRecords(skill, "cursor")).toEqual([
      { relpath: "rules/docs-helper/references/style.md", sourcePath: "skills/docs-helper/references/style.md" },
    ]);
    expect(skillVerbatimRecords(skill, "copilot")[0]!.relpath).toBe(
      "instructions/docs-helper/references/style.md",
    );
  });
});
