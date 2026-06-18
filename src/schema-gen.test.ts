import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifestSchema, buildManifestSchemaJson, SCHEMA_OUTPUT_PATH } from "./schema-gen.js";
import { TARGET_ORDER } from "./model.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const scriptPath = resolve(here, "schema-gen.ts");
const schemaAbs = resolve(repoRoot, SCHEMA_OUTPUT_PATH);

/** Run the schema-gen CLI; returns the exit code (0 on success, nonzero on drift/error). */
function runCli(args: string[]): number {
  try {
    execFileSync("bun", ["run", scriptPath, ...args], { cwd: repoRoot, encoding: "utf-8" });
    return 0;
  } catch (err) {
    return (err as { status?: number }).status ?? 1;
  }
}

describe("buildManifestSchema", () => {
  it("derives a JSON Schema from the Manifest Zod schema with stable metadata", () => {
    const schema = buildManifestSchema();
    expect(schema["$schema"]).toBe("http://json-schema.org/draft-07/schema#");
    expect(schema["$id"]).toBe("tools.manifest.schema.json");
    expect(schema["title"]).toBe("Agent-Docs Tool Manifest");
    // The Manifest shape is reflected: top-level version/config/tools properties exist.
    const props = (schema["properties"] ?? {}) as Record<string, unknown>;
    expect(props["version"]).toBeDefined();
    expect(props["config"]).toBeDefined();
    expect(props["tools"]).toBeDefined();
  });

  it("is deterministic across two calls (byte-identical serialization)", () => {
    expect(buildManifestSchemaJson()).toBe(buildManifestSchemaJson());
  });

  it("produces a trailing newline and 2-space indentation", () => {
    const text = buildManifestSchemaJson();
    expect(text.endsWith("\n")).toBe(true);
    expect(text).toContain('\n  "');
  });
});

describe("manifest JSON-Schema drift (08 §7.2, REQ-DISC-03, SC-08)", () => {
  it("committed schema matches a fresh generation (schema:check)", () => {
    // Item 021 commits schemas/tools.manifest.schema.json; it must equal a fresh
    // build from the Zod Manifest, byte-for-byte (REQ-DISC-03).
    const committed = readFileSync(schemaAbs, "utf-8");
    expect(committed).toBe(buildManifestSchemaJson());
  });

  it("detects a mutated committed schema as drift", () => {
    const committed = readFileSync(schemaAbs, "utf-8");
    const mutated = committed.replace(/"title": "[^"]*"/, '"title": "Tampered"');
    expect(mutated).not.toBe(buildManifestSchemaJson());
  });

  it("binds the default targets to TARGET_ORDER (not a re-spelled literal)", () => {
    const schema = buildManifestSchema();
    const props = schema["properties"] as Record<string, { properties?: unknown }>;
    const config = props["config"]!;
    const targets = (config.properties as Record<string, { default?: unknown }>)["targets"]!;
    expect(targets.default).toEqual(TARGET_ORDER);
  });
});

describe("schema-gen --check", () => {
  // Preserve whatever is committed (if anything) so the test leaves the tree as it found it.
  const hadFile = existsSync(schemaAbs);
  const original = hadFile ? readFileSync(schemaAbs, "utf-8") : null;

  afterAll(() => {
    if (original !== null) writeFileSync(schemaAbs, original);
    else if (existsSync(schemaAbs)) rmSync(schemaAbs);
  });

  it("passes against a freshly written schema and fails against a mutated one", () => {
    // Default mode writes the committed schema byte-stably.
    expect(runCli([])).toBe(0);
    expect(readFileSync(schemaAbs, "utf-8")).toBe(buildManifestSchemaJson());

    // --check exits zero when the committed schema matches the Zod source.
    expect(runCli(["--check"])).toBe(0);

    // Mutate the committed file → --check must exit nonzero (drift).
    writeFileSync(schemaAbs, buildManifestSchemaJson() + "drift\n");
    expect(runCli(["--check"])).not.toBe(0);

    // Regenerate restores sync.
    expect(runCli([])).toBe(0);
    expect(runCli(["--check"])).toBe(0);
  });
});
