import { describe, it, expect } from "vitest";
import { cursorTransform } from "./cursor.js";
import { TRANSFORMS } from "./index.js";
import { skillVerbatimRecords } from "./_shared.js";
import { PROVENANCE } from "../model.js";
import type { AgentRecord, CommandRecord, SkillRecord } from "../model.js";

function makeSkill(overrides: Partial<SkillRecord> = {}): SkillRecord {
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
    ownRefs: [],
    sourcePath: "skills/docs-helper/SKILL.md",
    ...overrides,
  };
}

function makeAgent(): AgentRecord {
  return {
    name: "doc-reviewer",
    description: "Reviews documentation for clarity.",
    claudeKeys: new Map<string, unknown>([
      ["tools", ["Read", "Grep"]],
      ["model", "opus"],
    ]),
    body: "You review docs for clarity and accuracy...\n",
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

describe("cursorTransform (04 §8)", () => {
  it("is registered under the cursor key with target=cursor", () => {
    expect(TRANSFORMS.cursor).toBe(cursorTransform);
    expect(cursorTransform.target).toBe("cursor");
  });

  it("transformSkill emits flattened rules/<n>.mdc with expected frontmatter and body", () => {
    const out = cursorTransform.transformSkill(makeSkill());
    const file = out.files[0]!;
    expect(file.relpath).toBe("rules/docs-helper.mdc");
    // Form A provenance is the first in-block line.
    expect(file.content).toContain(PROVENANCE.yamlComment("skills/docs-helper/SKILL.md"));
    expect(file.content).toContain("description: Help with docs.");
    expect(file.content).toContain("globs: []");
    expect(file.content).toContain("alwaysApply: false");
    expect(file.content).toContain("Skill body line.");
    // No name/metadata key in the emitted frontmatter (flattened + dropped).
    expect(file.content).not.toMatch(/^name:/m);
    expect(file.content).not.toContain("allowed-tools");
  });

  it("drops argument-hint (resolved from nested metadata) and metadata for a skill", () => {
    const out = cursorTransform.transformSkill(makeSkill());
    expect(out.drops.map((d) => d.construct)).toEqual(["skill.argument-hint", "skill.metadata"]);
    expect(out.drops.every((d) => d.kind === "fallback")).toBe(true);
  });

  it("does not drop argument-hint when absent from nested metadata", () => {
    const skill = makeSkill({
      metadata: new Map<string, unknown>([
        ["metadata", new Map<string, unknown>([["allowed-tools", ["Read"]]])],
      ]),
    });
    const out = cursorTransform.transformSkill(skill);
    expect(out.drops.map((d) => d.construct)).toEqual(["skill.metadata"]);
  });

  it("maps skill ownRefs to verbatim copies under rules/<n>/", () => {
    const skill = makeSkill({
      ownRefs: ["skills/docs-helper/references/style.md", "skills/docs-helper/scripts/run.sh"],
    });
    const refs = skillVerbatimRecords(skill, "cursor");
    expect(refs).toEqual([
      { relpath: "rules/docs-helper/references/style.md", sourcePath: skill.ownRefs[0] },
      { relpath: "rules/docs-helper/scripts/run.sh", sourcePath: skill.ownRefs[1] },
    ]);
  });

  it("transformAgent emits agents/<n>.md (not .mdc) and drops every claudeKey", () => {
    const out = cursorTransform.transformAgent(makeAgent());
    const file = out.files[0]!;
    expect(file.relpath).toBe("agents/doc-reviewer.md");
    expect(file.content).toContain("name: doc-reviewer");
    expect(file.content).toContain(PROVENANCE.yamlComment("agents/doc-reviewer.md"));
    expect(out.drops.map((d) => d.construct).sort()).toEqual(["agent.model", "agent.tools"]);
    expect(out.drops.every((d) => d.kind === "fallback")).toBe(true);
  });

  it("transformCommand emits a body-only commands/<n>.md (Form B) and drops argument-hint", () => {
    const out = cursorTransform.transformCommand(makeCommand());
    const file = out.files[0]!;
    expect(file.relpath).toBe("commands/summarize.md");
    expect(file.content.startsWith(PROVENANCE.htmlComment() + "\n\n")).toBe(true);
    expect(file.content).toContain("Summarize the document.");
    // No frontmatter fence in a Form B body-only file.
    expect(file.content).not.toMatch(/^---/);
    expect(out.drops.map((d) => d.construct)).toEqual(["command.argument-hint"]);
    expect(out.drops[0]!.kind).toBe("fallback");
  });

  it("transformCommand records no drop when argument-hint is absent", () => {
    const cmd = makeCommand();
    delete cmd.argumentHint;
    const out = cursorTransform.transformCommand(cmd);
    expect(out.drops).toEqual([]);
  });

  it("aggregateManifest returns null (cursor has no aggregate)", () => {
    expect(cursorTransform.aggregateManifest([], { name: "x", version: "1" })).toBeNull();
  });

  it("output is byte-identical across two emits (REQ-EMIT-06)", () => {
    expect(cursorTransform.transformSkill(makeSkill()).files[0]!.content).toBe(
      cursorTransform.transformSkill(makeSkill()).files[0]!.content,
    );
    expect(cursorTransform.transformCommand(makeCommand()).files[0]!.content).toBe(
      cursorTransform.transformCommand(makeCommand()).files[0]!.content,
    );
  });
});
