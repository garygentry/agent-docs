import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadManifest } from "./manifest.js";
import { ManifestValidationError, SourceNotFoundError } from "./errors.js";

const repos: string[] = [];

/** Build an isolated temp repo and return its absolute root. */
function makeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "manifest-test-"));
  repos.push(root);
  return root;
}

/** Write a file under root, creating parent dirs. */
function write(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

afterEach(() => {
  while (repos.length) {
    const root = repos.pop();
    if (root) rmSync(root, { recursive: true, force: true });
  }
});

describe("loadManifest", () => {
  it("loads a minimal valid manifest and applies config defaults", () => {
    const root = makeRepo();
    write(
      root,
      "skills/docs-helper/SKILL.md",
      "---\nname: docs-helper\ndescription: A helper.\n---\nBody.\n",
    );
    write(
      root,
      "tools.manifest.json",
      JSON.stringify({
        version: 1,
        tools: [{ name: "docs-helper", type: "skill", source: "skills/docs-helper" }],
      }),
    );

    const manifest = loadManifest(join(root, "tools.manifest.json"), root);

    expect(manifest.version).toBe(1);
    expect(manifest.tools).toHaveLength(1);
    // Zod defaults applied for the omitted config block.
    expect(manifest.config.skillsDir).toBe("skills");
    expect(manifest.config.targets).toEqual(["claude", "codex", "copilot", "cursor", "gemini"]);
  });

  it("throws ManifestValidationError with formatted issues when version/tools are missing", () => {
    const root = makeRepo();
    write(root, "tools.manifest.json", JSON.stringify({ config: {} }));

    let caught: unknown;
    try {
      loadManifest(join(root, "tools.manifest.json"), root);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ManifestValidationError);
    const issues = (caught as ManifestValidationError).issues;
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.startsWith("version"))).toBe(true);
    expect(issues.some((i) => i.startsWith("tools"))).toBe(true);
  });

  it("throws SourceNotFoundError when a ToolEntry.source does not exist", () => {
    const root = makeRepo();
    write(
      root,
      "tools.manifest.json",
      JSON.stringify({
        version: 1,
        tools: [{ name: "missing", type: "skill", source: "skills/missing" }],
      }),
    );

    expect(() => loadManifest(join(root, "tools.manifest.json"), root)).toThrow(
      SourceNotFoundError,
    );
  });

  it("throws ManifestValidationError when frontmatter name disagrees (TQ-4)", () => {
    const root = makeRepo();
    write(root, "skills/docs-helper/SKILL.md", "---\nname: wrong-name\n---\nBody.\n");
    write(
      root,
      "tools.manifest.json",
      JSON.stringify({
        version: 1,
        tools: [{ name: "docs-helper", type: "skill", source: "skills/docs-helper" }],
      }),
    );

    expect(() => loadManifest(join(root, "tools.manifest.json"), root)).toThrow(
      ManifestValidationError,
    );
  });
});
