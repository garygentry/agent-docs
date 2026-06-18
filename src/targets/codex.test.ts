import { describe, it, expect } from "vitest";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import { codexTransform, renderCodexAgentToml } from "./codex.js";
import { TRANSFORMS } from "./index.js";
import { PROVENANCE } from "../model.js";
import type { AgentRecord, CommandRecord, SkillRecord } from "../model.js";

function makeSkill(): SkillRecord {
  return {
    name: "docs-helper",
    description: "Help with docs.",
    metadata: new Map<string, unknown>([
      [
        "metadata",
        new Map<string, unknown>([["allowed-tools", ["Read", "Grep"]]]),
      ],
    ]),
    body: "Skill body line.\n",
    ownRefs: [],
    sourcePath: "skills/docs-helper/SKILL.md",
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

describe("codexTransform (04 §7)", () => {
  it("is registered under the codex key with target=codex", () => {
    expect(TRANSFORMS.codex).toBe(codexTransform);
    expect(codexTransform.target).toBe("codex");
  });

  it("transformSkill emits skills/<n>/SKILL.md and drops metadata", () => {
    const out = codexTransform.transformSkill(makeSkill());
    expect(out.files[0]!.relpath).toBe("skills/docs-helper/SKILL.md");
    expect(out.files[0]!.content).toContain(
      PROVENANCE.yamlComment("skills/docs-helper/SKILL.md"),
    );
    expect(out.drops.map((d) => d.construct)).toEqual(["skill.metadata"]);
    expect(out.drops[0]!.kind).toBe("fallback");
  });

  it("transformAgent emits deterministic TOML with expected keys and records claudeKey drops (TQ-2)", () => {
    const out = codexTransform.transformAgent(makeAgent());
    const file = out.files[0]!;
    expect(file.relpath).toBe("agents/doc-reviewer.toml");
    // Provenance is the leading TOML comment line.
    expect(file.content.startsWith(PROVENANCE.yamlComment("agents/doc-reviewer.md") + "\n")).toBe(
      true,
    );
    // Parses to the expected TOML shape (name, description, developer_instructions).
    const parsed = parseToml(file.content) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      "description",
      "developer_instructions",
      "name",
    ]);
    expect(parsed.name).toBe("doc-reviewer");
    expect(parsed.description).toBe("Reviews documentation for clarity.");
    expect(parsed.developer_instructions).toBe(
      "You review docs for clarity and accuracy...\n",
    );
    // Multiline body uses a TOML triple-quoted literal.
    expect(file.content).toContain("developer_instructions = '''");
    // Every structural claudeKey is dropped (empty keep-set).
    expect(out.drops.map((d) => d.construct).sort()).toEqual(["agent.model", "agent.tools"]);
    expect(out.drops.every((d) => d.kind === "fallback")).toBe(true);
    // One aggregate entry contributed.
    expect(out.manifestEntries).toEqual([
      { name: "doc-reviewer", description: "Reviews documentation for clarity." },
    ]);
  });

  it("renderCodexAgentToml falls back to a basic string when the body contains the literal delimiter", () => {
    const agent = makeAgent();
    agent.body = "weird ''' body\n";
    const toml = renderCodexAgentToml(agent);
    const parsed = parseToml(toml) as Record<string, unknown>;
    expect(parsed.developer_instructions).toBe("weird ''' body\n");
  });

  it("transformCommand emits prompts/<n>.md and records the deprecation fallback", () => {
    const out = codexTransform.transformCommand(makeCommand());
    expect(out.files[0]!.relpath).toBe("prompts/summarize.md");
    expect(out.drops.map((d) => d.construct)).toEqual(["command:codex"]);
    expect(out.drops[0]!.kind).toBe("fallback");
  });

  it("aggregateManifest emits openai.yaml with _generated first (Form C)", () => {
    const entries = [
      { name: "a-agent", description: "A." },
      { name: "b-agent", description: "B." },
    ];
    const file = codexTransform.aggregateManifest(entries, { name: "x", version: "1" })!;
    expect(file).not.toBeNull();
    expect(file.relpath).toBe("agents/openai.yaml");
    // _generated must be the first serialized key (Form C ordering).
    expect(file.content.startsWith("_generated:")).toBe(true);
    const doc = parseYaml(file.content) as Record<string, unknown>;
    expect(Object.keys(doc)).toEqual(["_generated", "agents"]);
    expect(doc.agents).toEqual(entries);
  });

  it("aggregateManifest returns null for no entries", () => {
    expect(codexTransform.aggregateManifest([], { name: "x", version: "1" })).toBeNull();
  });

  it("output is byte-identical across two emits (REQ-EMIT-06)", () => {
    expect(codexTransform.transformAgent(makeAgent()).files[0]!.content).toBe(
      codexTransform.transformAgent(makeAgent()).files[0]!.content,
    );
    const entries = [{ name: "a", description: "A." }];
    const id = { name: "x", version: "1" };
    expect(codexTransform.aggregateManifest(entries, id)!.content).toBe(
      codexTransform.aggregateManifest(entries, id)!.content,
    );
  });
});
