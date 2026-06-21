import { describe, it, expect } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import type { EmittedFile } from "./model.js";
import { YAML_OPTS, REGEN_CMD } from "./model.js";
import { ManifestValidationError } from "./errors.js";
import {
  validateTargetManifest,
  CodexManifestSchema,
  GeminiExtensionSchema,
} from "./validate-manifests.js";

const file = (relpath: string, content: string): EmittedFile => ({
  relpath,
  content,
  mode: 0o644,
});

const validGeminiDoc = {
  _generated: { source: "skills/*", regenerate: REGEN_CMD },
  name: "agent-docs-scaffold",
  version: "0.1.0",
  skills: [{ name: "docs-helper", description: "Helps write docs." }],
};

const validCodexDoc = {
  _generated: { source: "agents/*", regenerate: REGEN_CMD },
  agents: [{ name: "triage", description: "Triages issues." }],
};

describe("validateTargetManifest — gemini", () => {
  it("accepts a well-formed gemini-extension.json", () => {
    const files = [file("gemini-extension.json", JSON.stringify(validGeminiDoc, null, 2) + "\n")];
    expect(() => validateTargetManifest("gemini", files)).not.toThrow();
  });

  it("accepts a <target>/-prefixed relpath (emit pipeline form)", () => {
    const files = [
      file("gemini/gemini-extension.json", JSON.stringify(validGeminiDoc, null, 2) + "\n"),
    ];
    expect(() => validateTargetManifest("gemini", files)).not.toThrow();
  });

  it("rejects a malformed gemini-extension.json with a clear message", () => {
    const broken = { ...validGeminiDoc, name: 123, skills: "nope" };
    const files = [file("gemini-extension.json", JSON.stringify(broken, null, 2) + "\n")];
    let caught: unknown;
    try {
      validateTargetManifest("gemini", files);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ManifestValidationError);
    const e = caught as ManifestValidationError;
    expect(e.code).toBe("MANIFEST_INVALID");
    expect(e.issues.length).toBeGreaterThan(0);
    expect(e.message).toContain("gemini-extension.json");
  });

  it("rejects unparseable JSON", () => {
    const files = [file("gemini-extension.json", "{ not json")];
    expect(() => validateTargetManifest("gemini", files)).toThrow(ManifestValidationError);
  });
});

describe("validateTargetManifest — codex", () => {
  it("accepts a well-formed openai.yaml aggregate", () => {
    const files = [file("agents/openai.yaml", stringifyYaml(validCodexDoc, YAML_OPTS))];
    expect(() => validateTargetManifest("codex", files)).not.toThrow();
  });

  it("rejects a malformed openai.yaml with a clear message", () => {
    const broken = { _generated: { source: "agents/*" }, agents: [{ name: "x" }] };
    const files = [file("agents/openai.yaml", stringifyYaml(broken, YAML_OPTS))];
    let caught: unknown;
    try {
      validateTargetManifest("codex", files);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ManifestValidationError);
    expect((caught as ManifestValidationError).message).toContain("openai.yaml");
  });
});

describe("validateTargetManifest — no-aggregate targets", () => {
  it("is a no-op for claude/copilot/cursor", () => {
    const files = [file("skills/docs-helper/SKILL.md", "# doc")];
    expect(() => validateTargetManifest("claude", files)).not.toThrow();
    expect(() => validateTargetManifest("copilot", files)).not.toThrow();
    expect(() => validateTargetManifest("cursor", files)).not.toThrow();
  });
});

describe("exported Zod shapes", () => {
  it("CodexManifestSchema and GeminiExtensionSchema validate their docs", () => {
    expect(CodexManifestSchema.safeParse(validCodexDoc).success).toBe(true);
    expect(GeminiExtensionSchema.safeParse(validGeminiDoc).success).toBe(true);
  });
});
