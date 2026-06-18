import { describe, it, expect } from "vitest";
import { parse as parseToml } from "smol-toml";
import { geminiTransform, renderGeminiCommandToml } from "./gemini.js";
import { TRANSFORMS } from "./index.js";
import { PROVENANCE } from "../model.js";
import type { AgentRecord, CommandRecord, SkillRecord } from "../model.js";

function makeSkill(): SkillRecord {
  return {
    name: "docs-helper",
    description: "Help with docs.",
    metadata: new Map<string, unknown>([
      ["metadata", new Map<string, unknown>([["allowed-tools", ["Read", "Grep"]]])],
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

describe("geminiTransform (04 §9)", () => {
  it("is registered under the gemini key with target=gemini", () => {
    expect(TRANSFORMS.gemini).toBe(geminiTransform);
    expect(geminiTransform.target).toBe("gemini");
  });

  it("transformSkill emits skills/<n>/<n>.md, drops metadata, contributes an aggregate entry", () => {
    const out = geminiTransform.transformSkill(makeSkill());
    expect(out.files[0]!.relpath).toBe("skills/docs-helper/docs-helper.md");
    expect(out.files[0]!.content).toContain(
      PROVENANCE.yamlComment("skills/docs-helper/SKILL.md"),
    );
    expect(out.drops.map((d) => d.construct)).toEqual(["skill.metadata"]);
    expect(out.drops[0]!.kind).toBe("fallback");
    expect(out.manifestEntries).toEqual([
      { name: "docs-helper", description: "Help with docs." },
    ]);
  });

  it("transformAgent emits agents/<n>.md and drops every structural claudeKey", () => {
    const out = geminiTransform.transformAgent(makeAgent());
    expect(out.files[0]!.relpath).toBe("agents/doc-reviewer.md");
    expect(out.drops.map((d) => d.construct).sort()).toEqual(["agent.model", "agent.tools"]);
    expect(out.drops.every((d) => d.kind === "fallback")).toBe(true);
    expect(out.manifestEntries).toEqual([]);
  });

  it("transformCommand emits deterministic TOML via smol-toml, flattening argument-hint", () => {
    const out = geminiTransform.transformCommand(makeCommand());
    const file = out.files[0]!;
    expect(file.relpath).toBe("commands/summarize.toml");
    expect(file.content.startsWith(PROVENANCE.yamlComment("commands/summarize.md") + "\n")).toBe(
      true,
    );
    const parsed = parseToml(file.content) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["description", "prompt"]);
    expect(parsed.description).toBe("Summarize a document.");
    expect(parsed.prompt).toBe("Summarize the document.\n\n\nArguments: [path]");
    expect(file.content).toContain("prompt = '''");
    // argument-hint has no native field → flattened into prose and drop-recorded.
    expect(out.drops.map((d) => d.construct)).toEqual(["command.argument-hint"]);
    expect(out.drops[0]!.kind).toBe("fallback");
  });

  it("transformCommand without argument-hint records no drop and emits the bare body", () => {
    const cmd = makeCommand();
    delete cmd.argumentHint;
    const out = geminiTransform.transformCommand(cmd);
    const parsed = parseToml(out.files[0]!.content) as Record<string, unknown>;
    expect(parsed.prompt).toBe("Summarize the document.\n");
    expect(out.drops).toEqual([]);
  });

  it("renderGeminiCommandToml falls back to a basic string when the prompt contains the delimiter", () => {
    const toml = renderGeminiCommandToml("d", "weird ''' prompt\n", "commands/x.md");
    const parsed = parseToml(toml) as Record<string, unknown>;
    expect(parsed.prompt).toBe("weird ''' prompt\n");
  });

  it("aggregateManifest threads the identity (no hardcoded name/version) with _generated first (Form C)", () => {
    const entries = [
      { name: "a-skill", description: "A." },
      { name: "b-skill", description: "B." },
    ];
    const identity = { name: "my-plugin", version: "9.9.9" };
    const file = geminiTransform.aggregateManifest(entries, identity)!;
    expect(file).not.toBeNull();
    expect(file.relpath).toBe("gemini-extension.json");
    // _generated must be the first serialized key (Form C ordering).
    const doc = JSON.parse(file.content) as Record<string, unknown>;
    expect(Object.keys(doc)).toEqual(["_generated", "name", "version", "skills"]);
    // Identity is threaded from the parameter, NOT hardcoded.
    expect(doc.name).toBe("my-plugin");
    expect(doc.version).toBe("9.9.9");
    expect(doc.skills).toEqual(entries);
    // Strict JSON: 2-space indent, trailing newline.
    expect(file.content.endsWith("\n")).toBe(true);
    expect(file.content).toBe(JSON.stringify(doc, null, 2) + "\n");
  });

  it("aggregateManifest returns null for no entries", () => {
    expect(geminiTransform.aggregateManifest([], { name: "x", version: "1" })).toBeNull();
  });

  it("output is byte-identical across two emits (REQ-EMIT-06)", () => {
    expect(geminiTransform.transformCommand(makeCommand()).files[0]!.content).toBe(
      geminiTransform.transformCommand(makeCommand()).files[0]!.content,
    );
    const entries = [{ name: "a-skill", description: "A." }];
    const id = { name: "my-plugin", version: "9.9.9" };
    expect(geminiTransform.aggregateManifest(entries, id)!.content).toBe(
      geminiTransform.aggregateManifest(entries, id)!.content,
    );
  });
});
