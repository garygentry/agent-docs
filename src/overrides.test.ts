import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { EmittedFile } from "./model.js";
import type { ResolvedRoots } from "./config.js";
import { applyOverrides, loadOverrides } from "./overrides.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Build a temp repo with an overrides/ tree and return ResolvedRoots. */
function makeRoots(): ResolvedRoots {
  const repoRoot = mkdtempSync(join(tmpdir(), "overrides-test-"));
  tmpDirs.push(repoRoot);
  const overridesDir = join(repoRoot, "overrides");
  mkdirSync(overridesDir, { recursive: true });
  return {
    repoRoot,
    skillsDir: join(repoRoot, "skills"),
    agentsDir: join(repoRoot, "agents"),
    commandsDir: join(repoRoot, "commands"),
    referencesDir: join(repoRoot, "references"),
    scriptsDir: join(repoRoot, "scripts"),
    overridesDir,
    adaptersDir: join(repoRoot, "adapters"),
  };
}

/** Write an override file at overrides/<target>/<relpath>. */
function writeOverride(
  roots: ResolvedRoots,
  target: string,
  relpath: string,
  content: string,
): void {
  const full = join(roots.overridesDir, target, relpath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

describe("loadOverrides", () => {
  it("returns an empty overlay for a missing overridesDir (no throw)", () => {
    const roots = makeRoots();
    rmSync(roots.overridesDir, { recursive: true, force: true });
    const set = loadOverrides(roots, ["claude", "cursor"]);
    expect(set.byAdapterPath.size).toBe(0);
  });

  it("reads overrides/<target>/<relpath> into a path-keyed set with preserved modes", () => {
    const roots = makeRoots();
    writeOverride(roots, "cursor", "rules/foo.mdc", "rule body\n");
    chmodSync(join(roots.overridesDir, "cursor", "rules/foo.mdc"), 0o644);
    const scriptPath = join(roots.overridesDir, "claude", "scripts/run.sh");
    mkdirSync(join(scriptPath, ".."), { recursive: true });
    writeFileSync(scriptPath, "#!/bin/sh\necho hi\n", "utf8");
    chmodSync(scriptPath, 0o755);

    const set = loadOverrides(roots, ["claude", "cursor"]);
    expect([...set.byAdapterPath.keys()].sort()).toEqual([
      "claude/scripts/run.sh",
      "cursor/rules/foo.mdc",
    ]);
    expect(set.byAdapterPath.get("cursor/rules/foo.mdc")?.mode).toBe(0o644);
    expect(set.byAdapterPath.get("claude/scripts/run.sh")?.mode).toBe(0o755);
  });

  it("ignores subdirs for targets not in the configured list", () => {
    const roots = makeRoots();
    writeOverride(roots, "gemini", "commands/x.toml", "x\n");
    const set = loadOverrides(roots, ["claude", "cursor"]);
    expect(set.byAdapterPath.size).toBe(0);
  });
});

describe("applyOverrides", () => {
  const emitted: EmittedFile[] = [
    { relpath: "cursor/rules/foo.mdc", content: "GENERATED body\n", mode: 0o644 },
    { relpath: "claude/skills/bar/SKILL.md", content: "skill\n", mode: 0o644 },
  ];

  it("whole-file-replaces a matching emitted file and lists it in overridden[]", () => {
    const roots = makeRoots();
    writeOverride(roots, "cursor", "rules/foo.mdc", "AUTHORED — no header\n");
    const overrides = loadOverrides(roots, ["claude", "cursor"]);

    const result = applyOverrides(emitted, overrides);
    const replaced = result.files.find((f) => f.relpath === "cursor/rules/foo.mdc");
    expect(replaced?.content).toBe("AUTHORED — no header\n");
    expect(result.overridden).toEqual(["cursor/rules/foo.mdc"]);
    expect(result.staleOverrides).toEqual([]);
  });

  it("preserves override bytes verbatim with no provenance header", () => {
    const roots = makeRoots();
    const bytes = "no-header\n\ttabbed\nverbatim";
    writeOverride(roots, "cursor", "rules/foo.mdc", bytes);
    const overrides = loadOverrides(roots, ["cursor"]);

    const result = applyOverrides(emitted, overrides);
    const replaced = result.files.find((f) => f.relpath === "cursor/rules/foo.mdc");
    expect(replaced?.content).toBe(bytes);
    expect(replaced?.content).not.toContain("GENERATED");
  });

  it("collects a stale override without applying it or throwing", () => {
    const roots = makeRoots();
    writeOverride(roots, "cursor", "rules/gone.mdc", "orphan override\n");
    const overrides = loadOverrides(roots, ["cursor"]);

    let result;
    expect(() => {
      result = applyOverrides(emitted, overrides);
    }).not.toThrow();
    expect(result!.staleOverrides).toEqual(["cursor/rules/gone.mdc"]);
    expect(result!.overridden).toEqual([]);
    // Emitted files are untouched.
    expect(result!.files).toHaveLength(emitted.length);
  });

  it("returns files/overridden/staleOverrides in stable POSIX sort", () => {
    const roots = makeRoots();
    writeOverride(roots, "cursor", "rules/foo.mdc", "x\n");
    writeOverride(roots, "claude", "z-stale.md", "z\n");
    writeOverride(roots, "claude", "a-stale.md", "a\n");
    const overrides = loadOverrides(roots, ["claude", "cursor"]);

    const result = applyOverrides(emitted, overrides);
    expect(result.files.map((f) => f.relpath)).toEqual([
      "claude/skills/bar/SKILL.md",
      "cursor/rules/foo.mdc",
    ]);
    expect(result.staleOverrides).toEqual(["claude/a-stale.md", "claude/z-stale.md"]);
  });

  it("does not mutate the input file array", () => {
    const roots = makeRoots();
    writeOverride(roots, "cursor", "rules/foo.mdc", "new\n");
    const overrides = loadOverrides(roots, ["cursor"]);
    const input: EmittedFile[] = [
      { relpath: "cursor/rules/foo.mdc", content: "old\n", mode: 0o644 },
    ];
    applyOverrides(input, overrides);
    expect(input[0]!.content).toBe("old\n");
  });
});

// --- Cross-cutting override survival & distinguishability (08 §5.3, SC-05) -------
// These exercise the full build pipeline (emit -> overlay -> publish) over a real
// fixture repo, proving an override survives a rebuild byte-for-byte and that the
// overridden file is distinguishable as author-sourced (no provenance header).

import { readFileSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { driftCheck } from "./driftguard.js";
import { emit } from "./emit.js";
import {
  buildAndPublish,
  cleanupFixtureRepo,
  makeFixtureRepo,
  type FixtureRepo,
} from "./test/__fixtures__/index.js";

// Cursor emits a skill as `rules/<n>.mdc` (04 §8.1), so the override slot that
// replaces the sample skill's cursor output is `cursor/rules/sample.mdc` — the
// EmittedFile.relpath it shadows (05 §2). It must match an emitted relpath exactly.
const OVERRIDE_REL = "cursor/rules/sample.mdc";
const OVERRIDE_BODY = "---\ndescription: hand authored\nalwaysApply: true\n---\nCustom.\n";

describe("override slots (SC-05, cross-cutting)", () => {
  let repos: FixtureRepo[] = [];
  afterEach(() => {
    repos.forEach(cleanupFixtureRepo);
    repos = [];
  });

  it("overlays author content into the target output and survives rebuild byte-for-byte", () => {
    const repo = makeFixtureRepo({
      skills: ["sample"],
      overrides: { [OVERRIDE_REL]: OVERRIDE_BODY },
    });
    repos.push(repo);
    buildAndPublish(repo.manifest, repo.roots);
    buildAndPublish(repo.manifest, repo.roots); // rebuild must NOT clobber the override
    const onDisk = readFileSync(
      pathJoin(repo.roots.adaptersDir, "cursor", "rules", "sample.mdc"),
      "utf8",
    );
    expect(onDisk).toBe(OVERRIDE_BODY);
  });

  it("driftCheck passes — an override is not drift", () => {
    const repo = makeFixtureRepo({
      skills: ["sample"],
      overrides: { [OVERRIDE_REL]: OVERRIDE_BODY },
    });
    repos.push(repo);
    buildAndPublish(repo.manifest, repo.roots);
    expect(driftCheck(repo.manifest, repo.roots)).toEqual([]);
  });

  it("overridden file is distinguishable as author-sourced (no provenance header)", () => {
    const repo = makeFixtureRepo({
      skills: ["sample"],
      overrides: { [OVERRIDE_REL]: OVERRIDE_BODY },
    });
    repos.push(repo);
    // Read `overridden` from the OverlayResult (05 §3.2) — applyOverrides computes it.
    const overlay = buildAndPublish(repo.manifest, repo.roots);
    expect(overlay.overridden).toContain(OVERRIDE_REL);
    const file = overlay.files.find((f) => f.relpath === OVERRIDE_REL)!;
    expect(file.content).toBe(OVERRIDE_BODY);
    expect(file.content).not.toMatch(/GENERATED — DO NOT EDIT/);
  });

  it("a stale override is a non-fatal warning, not a throw", () => {
    const repo = makeFixtureRepo({
      skills: ["sample"],
      overrides: { "cursor/rules/gone.mdc": "x" }, // no canonical 'gone'
    });
    repos.push(repo);
    let overlay!: ReturnType<typeof applyOverrides>;
    expect(() => {
      const result = emit(repo.manifest, repo.roots);
      const overrides = loadOverrides(repo.roots, repo.manifest.config.targets);
      overlay = applyOverrides(result.files, overrides);
    }).not.toThrow();
    expect(overlay.staleOverrides).toContain("cursor/rules/gone.mdc");
  });
});
