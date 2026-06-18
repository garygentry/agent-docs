/**
 * Emitted target-manifest schema validation (08 §7.1, REQ-VALID-03, SC-08).
 *
 * The codex `agents/openai.yaml` and gemini `gemini-extension.json` aggregates
 * (04/05) must validate against each target's expected shape — the Zod
 * validators owned by `validate-manifests.ts` (06 §4). This suite emits a
 * fixture, runs the validator on the real aggregate, and proves a deliberately
 * corrupted manifest is rejected (never a silent pass).
 */
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { emit } from "../emit.js";
import { ManifestValidationError } from "../errors.js";
import {
  CodexManifestSchema,
  GeminiExtensionSchema,
  validateTargetManifest,
} from "../validate-manifests.js";
import type { EmittedFile } from "../model.js";
import { cleanupFixtureRepo, makeFixtureRepo, type FixtureRepo } from "./__fixtures__/index.js";

let repos: FixtureRepo[] = [];
afterEach(() => {
  repos.forEach(cleanupFixtureRepo);
  repos = [];
});

/** Files for a single target (emit prefixes relpaths with `<target>/`). */
function targetFiles(files: EmittedFile[], target: string): EmittedFile[] {
  return files.filter((f) => f.relpath.startsWith(`${target}/`));
}

describe("emitted manifest schemas (REQ-VALID-03)", () => {
  it("codex openai.yaml validates against the expected shape", () => {
    const repo = makeFixtureRepo({ agents: ["helper"] });
    repos.push(repo);
    const result = emit(repo.manifest, repo.roots);
    const file = result.files.find((f) => f.relpath === "codex/agents/openai.yaml");
    expect(file).toBeDefined();
    expect(() => CodexManifestSchema.parse(parseYaml(file!.content))).not.toThrow();
    // The exported validator is also happy on the real emit output.
    expect(() => validateTargetManifest("codex", targetFiles(result.files, "codex"))).not.toThrow();
  });

  it("gemini gemini-extension.json validates and leads with _generated", () => {
    const repo = makeFixtureRepo({ skills: ["sample"] });
    repos.push(repo);
    const result = emit(repo.manifest, repo.roots);
    const file = result.files.find((f) => f.relpath === "gemini/gemini-extension.json");
    expect(file).toBeDefined();
    const json = JSON.parse(file!.content) as Record<string, unknown>;
    expect(Object.keys(json)[0]).toBe("_generated"); // Form C provenance (00 §5 / 04)
    expect(() => GeminiExtensionSchema.parse(json)).not.toThrow();
    expect(() => validateTargetManifest("gemini", targetFiles(result.files, "gemini"))).not.toThrow();
  });

  it("rejects a corrupted codex aggregate (no silent pass)", () => {
    const repo = makeFixtureRepo({ agents: ["helper"] });
    repos.push(repo);
    const result = emit(repo.manifest, repo.roots);
    const file = result.files.find((f) => f.relpath === "codex/agents/openai.yaml")!;
    // Drop the required `agents` array → schema must reject.
    const corrupted: EmittedFile = {
      ...file,
      content: "_generated:\n  source: x\n  regenerate: y\n",
    };
    expect(() => validateTargetManifest("codex", [corrupted])).toThrow(ManifestValidationError);
  });

  it("rejects a corrupted gemini aggregate (no silent pass)", () => {
    const repo = makeFixtureRepo({ skills: ["sample"] });
    repos.push(repo);
    const result = emit(repo.manifest, repo.roots);
    const file = result.files.find((f) => f.relpath === "gemini/gemini-extension.json")!;
    const obj = JSON.parse(file.content) as Record<string, unknown>;
    delete obj.skills; // required by GeminiExtensionSchema
    const corrupted: EmittedFile = { ...file, content: JSON.stringify(obj, null, 2) + "\n" };
    expect(() => validateTargetManifest("gemini", [corrupted])).toThrow(ManifestValidationError);
  });
});
