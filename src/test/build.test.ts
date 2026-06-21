import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { build, check } from "../cli.js";
import { DriftError } from "../errors.js";

const repos: string[] = [];

afterEach(() => {
  for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true });
});

/**
 * Build a minimal fixture repo: a package.json (plugin identity), a
 * tools.manifest.json, and one canonical skill. Returns the repo root.
 */
function makeFixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "build-"));
  repos.push(root);

  const write = (rel: string, content: string) => {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  };

  write(
    "package.json",
    `${JSON.stringify({ name: "fixture-plugin", version: "1.2.3", type: "module" }, null, 2)}\n`,
  );

  write(
    "skills/docs-helper/SKILL.md",
    `---
name: docs-helper
description: Helps with docs.
argument-hint: "[topic]"
---
Body of the skill.
`,
  );
  write("skills/docs-helper/references/style.md", "# Style guide\n");

  write(
    "tools.manifest.json",
    `${JSON.stringify(
      {
        version: 1,
        tools: [{ name: "docs-helper", type: "skill", source: "skills/docs-helper" }],
      },
      null,
      2,
    )}\n`,
  );

  return root;
}

describe("cli build", () => {
  it("produces adapters/ with zero manual steps and a subsequent --check passes", () => {
    const root = makeFixtureRepo();

    build(root);

    // adapters/ exists with all five target bundles + the coverage report.
    expect(existsSync(join(root, "adapters", "GENERATION-REPORT.md"))).toBe(true);
    for (const target of ["claude", "codex", "copilot", "cursor", "gemini"]) {
      expect(existsSync(join(root, "adapters", target))).toBe(true);
    }
    expect(existsSync(join(root, "adapters", "claude", "skills", "docs-helper", "SKILL.md"))).toBe(
      true,
    );

    // .claude-plugin/ manifests are written with the package identity.
    expect(existsSync(join(root, ".claude-plugin", "plugin.json"))).toBe(true);
    expect(existsSync(join(root, ".claude-plugin", "marketplace.json"))).toBe(true);
    const pluginJson = JSON.parse(
      readFileSync(join(root, ".claude-plugin", "plugin.json"), "utf8"),
    );
    expect(pluginJson.name).toBe("fixture-plugin");
    expect(pluginJson.version).toBe("1.2.3");

    // build --check on the freshly built tree reports no drift.
    expect(() => check(root)).not.toThrow();
  });

  it("is idempotent and byte-stable across two builds", () => {
    const root = makeFixtureRepo();

    build(root);
    const first = readFileSync(join(root, "adapters", "GENERATION-REPORT.md"), "utf8");
    build(root);
    const second = readFileSync(join(root, "adapters", "GENERATION-REPORT.md"), "utf8");

    expect(second).toBe(first);
    expect(() => check(root)).not.toThrow();
  });

  it("build --check throws DriftError when a committed adapter file is mutated", () => {
    const root = makeFixtureRepo();
    build(root);

    const skillPath = join(root, "adapters", "claude", "skills", "docs-helper", "SKILL.md");
    writeFileSync(skillPath, `${readFileSync(skillPath, "utf8")}\n<!-- tampered -->\n`);

    expect(() => check(root)).toThrow(DriftError);
  });
});
