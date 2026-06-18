import { describe, expect, it } from "vitest";

import { emitPlugin, type PluginMeta } from "./plugin.js";
import { EmitterError } from "./errors.js";

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
