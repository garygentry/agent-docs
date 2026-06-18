import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assemblePluginMeta } from "./cli.js";
import { emitPlugin, type PluginMeta } from "./plugin.js";
import { EmitterError } from "./errors.js";
import { cleanupFixtureRepo, makeFixtureRepo } from "./test/__fixtures__/index.js";

/** src/plugin.test.ts → repo root. */
const REPO_ROOT = path.resolve(import.meta.dirname, "..");

let repos: ReturnType<typeof makeFixtureRepo>[] = [];
afterEach(() => {
  repos.forEach(cleanupFixtureRepo);
  repos = [];
});

const META: PluginMeta = {
  name: "agent-docs",
  version: "0.1.0",
  description: "Author once in Claude-native form, emit adapters for Codex, Copilot, Cursor, and Gemini.",
  author: "Gary Gentry",
  keywords: ["documentation", "skills", "agents"],
};

describe("emitPlugin", () => {
  it("emits .claude-plugin/plugin.json and marketplace.json with the mapped fields", () => {
    const files = emitPlugin(META);
    expect(files.map((f) => f.relpath)).toEqual([
      ".claude-plugin/plugin.json",
      ".claude-plugin/marketplace.json",
    ]);
    expect(files.every((f) => f.mode === 0o644)).toBe(true);

    const plugin = JSON.parse(files[0]!.content);
    expect(plugin).toEqual({
      name: "agent-docs",
      version: "0.1.0",
      description: META.description,
      author: { name: "Gary Gentry" },
      keywords: ["documentation", "skills", "agents"],
    });

    const marketplace = JSON.parse(files[1]!.content);
    expect(marketplace).toEqual({
      name: "agent-docs",
      description: META.description,
      owner: { name: "Gary Gentry" },
      plugins: [
        {
          name: "agent-docs",
          source: ".",
          description: META.description,
          version: "0.1.0",
        },
      ],
    });
  });

  it("uses marketplaceDescription for marketplace.json when provided", () => {
    const files = emitPlugin({ ...META, marketplaceDescription: "Longer blurb." });
    expect(JSON.parse(files[1]!.content).description).toBe("Longer blurb.");
    expect(JSON.parse(files[0]!.content).description).toBe(META.description);
  });

  it("produces strict JSON with a trailing newline and no provenance header", () => {
    const files = emitPlugin(META);
    for (const f of files) {
      expect(f.content.endsWith("}\n")).toBe(true);
      expect(f.content.startsWith("{")).toBe(true);
      expect(f.content).not.toContain("_generated");
      expect(f.content).not.toContain("GENERATED");
    }
  });

  it("is byte-stable across two calls (REQ-EMIT-06)", () => {
    const a = emitPlugin(META);
    const b = emitPlugin(META);
    expect(a).toEqual(b);
    expect(a.map((f) => f.content)).toEqual(b.map((f) => f.content));
  });

  it("throws PLUGIN_META_INVALID for empty/non-kebab name", () => {
    for (const name of ["", "Agent_Docs", "AgentDocs"]) {
      expect(() => emitPlugin({ ...META, name })).toThrowError(EmitterError);
      try {
        emitPlugin({ ...META, name });
      } catch (e) {
        expect((e as EmitterError).code).toBe("PLUGIN_META_INVALID");
      }
    }
  });

  it("throws PLUGIN_META_INVALID for empty/non-SemVer version", () => {
    for (const version of ["", "1.0", "v1.0.0", "latest"]) {
      expect(() => emitPlugin({ ...META, version })).toThrowError(EmitterError);
    }
  });

  it("throws PLUGIN_META_INVALID for empty author", () => {
    expect(() => emitPlugin({ ...META, author: "" })).toThrowError(EmitterError);
  });
});

describe("plugin packaging — docs-helper sample (SC-07, REQ-PKG-01)", () => {
  it("emits .claude-plugin manifests matching the committed sample bundle", () => {
    // Identity assembled from package.json exactly as the CLI does on a real build
    // (07 §3.2 single source of truth), so the emitted manifests match the committed
    // .claude-plugin/ tree the drift guard protects.
    const meta = assemblePluginMeta(REPO_ROOT);
    const files = emitPlugin(meta);

    expect(files.map((f) => f.relpath)).toEqual([
      ".claude-plugin/plugin.json",
      ".claude-plugin/marketplace.json",
    ]);

    for (const f of files) {
      const committed = fs.readFileSync(path.join(REPO_ROOT, f.relpath), "utf8");
      expect(f.content, `emitted ${f.relpath} drifts from the committed bundle`).toBe(committed);
    }

    const plugin = JSON.parse(files[0]!.content);
    expect(plugin).toHaveProperty("name");
    expect(plugin).toHaveProperty("version");
    expect(plugin.name).toBe(meta.name);
  });

  it("produces a valid installable plugin.json for a fresh sample fixture (SC-07)", () => {
    // Exercises the shared fixture factory + afterEach cleanup. emitPlugin consumes
    // PluginMeta (not the repo), so the fixture stands in as a self-consistent sample
    // bundle whose manifest carries the required installable keys.
    const repo = makeFixtureRepo({ skills: ["docs-helper"] });
    repos.push(repo);

    const files = emitPlugin({ ...META, name: "docs-helper-sample" });
    const plugin = JSON.parse(files.find((f) => f.relpath.endsWith("plugin.json"))!.content);
    const marketplace = JSON.parse(
      files.find((f) => f.relpath.endsWith("marketplace.json"))!.content,
    );

    expect(plugin.name).toBe("docs-helper-sample");
    expect(plugin).toHaveProperty("version");
    expect(marketplace.plugins[0].source).toBe(".");
    expect(fs.existsSync(repo.root)).toBe(true);
  });
});
