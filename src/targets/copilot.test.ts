import { describe, it, expect } from "vitest";
import { copilotTransform } from "./copilot.js";
import { TRANSFORMS } from "./index.js";
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
      ["color", "blue"],
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

describe("copilotTransform (04 §10)", () => {
  it("is registered under the copilot key with target=copilot", () => {
    expect(TRANSFORMS.copilot).toBe(copilotTransform);
    expect(copilotTransform.target).toBe("copilot");
  });

  it("transformSkill emits instructions/<n>.instructions.md with {description, applyTo}", () => {
    const out = copilotTransform.transformSkill(makeSkill());
    const file = out.files[0]!;
    expect(file.relpath).toBe("instructions/docs-helper.instructions.md");
    expect(file.content).toContain(PROVENANCE.yamlComment("skills/docs-helper/SKILL.md"));
    expect(file.content).toContain("description: Help with docs.");
    expect(file.content).toContain("applyTo:");
    expect(file.content).toContain("Skill body line.");
    // name/metadata are not represented in Copilot instructions.
    expect(file.content).not.toMatch(/^name:/m);
    expect(file.content).not.toContain("allowed-tools");
  });

  it("drops argument-hint (from nested metadata) and metadata for a skill", () => {
    const out = copilotTransform.transformSkill(makeSkill());
    expect(out.drops.map((d) => d.construct)).toEqual(["skill.argument-hint", "skill.metadata"]);
    expect(out.drops.every((d) => d.kind === "fallback")).toBe(true);
    expect(out.drops.every((d) => d.target === "copilot")).toBe(true);
  });

  it("does not drop argument-hint when absent from nested metadata", () => {
    const skill = makeSkill({
      metadata: new Map<string, unknown>([
        ["metadata", new Map<string, unknown>([["allowed-tools", ["Read"]]])],
      ]),
    });
    const out = copilotTransform.transformSkill(skill);
    expect(out.drops.map((d) => d.construct)).toEqual(["skill.metadata"]);
  });

  it("records no skill drops when there is no metadata or hint", () => {
    const out = copilotTransform.transformSkill(
      makeSkill({ metadata: new Map<string, unknown>() }),
    );
    expect(out.drops).toEqual([]);
  });

  it("transformAgent emits agents/<n>.agent.md, keeps tools/model, drops the rest", () => {
    const out = copilotTransform.transformAgent(makeAgent());
    const file = out.files[0]!;
    expect(file.relpath).toBe("agents/doc-reviewer.agent.md");
    expect(file.content).toContain(PROVENANCE.yamlComment("agents/doc-reviewer.md"));
    expect(file.content).toContain("name: doc-reviewer");
    expect(file.content).toContain("description: Reviews documentation for clarity.");
    expect(file.content).toContain("model: opus");
    // color is not in the keep-set → dropped.
    expect(out.drops.map((d) => d.construct)).toEqual(["agent.color"]);
    expect(out.drops[0]!.kind).toBe("fallback");
  });

  it("transformCommand emits prompts/<n>.prompt.md with no drops (argument-hint maps cleanly)", () => {
    const out = copilotTransform.transformCommand(makeCommand());
    const file = out.files[0]!;
    expect(file.relpath).toBe("prompts/summarize.prompt.md");
    expect(file.content).toContain(PROVENANCE.yamlComment("commands/summarize.md"));
    expect(file.content).toContain("name: summarize");
    expect(file.content).toContain("argument-hint:");
    expect(file.content).toContain("Summarize the document.");
    expect(out.drops).toEqual([]);
  });

  it("transformCommand omits argument-hint when absent", () => {
    const cmd = makeCommand();
    delete cmd.argumentHint;
    const out = copilotTransform.transformCommand(cmd);
    expect(out.files[0]!.content).not.toContain("argument-hint:");
    expect(out.drops).toEqual([]);
  });

  it("aggregateManifest returns null (copilot has no aggregate)", () => {
    expect(copilotTransform.aggregateManifest([], { name: "x", version: "1" })).toBeNull();
  });

  it("output is byte-identical across two emits (REQ-EMIT-06)", () => {
    expect(copilotTransform.transformSkill(makeSkill()).files[0]!.content).toBe(
      copilotTransform.transformSkill(makeSkill()).files[0]!.content,
    );
    expect(copilotTransform.transformAgent(makeAgent()).files[0]!.content).toBe(
      copilotTransform.transformAgent(makeAgent()).files[0]!.content,
    );
    expect(copilotTransform.transformCommand(makeCommand()).files[0]!.content).toBe(
      copilotTransform.transformCommand(makeCommand()).files[0]!.content,
    );
  });
});
