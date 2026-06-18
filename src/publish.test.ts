import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveConfig } from "./config.js";
import { PathEscapeError } from "./errors.js";
import { EmitterConfig } from "./model.js";
import type { EmittedFile, VerbatimRecord } from "./model.js";
import type { ResolvedRoots } from "./config.js";
import { publish } from "./publish.js";

const tmpDirs: string[] = [];

function makeRoots(): ResolvedRoots {
  const repo = mkdtempSync(join(tmpdir(), "publish-test-"));
  tmpDirs.push(repo);
  return resolveConfig(EmitterConfig.parse({}), repo);
}

function file(relpath: string, content: string, mode = 0o644): EmittedFile {
  return { relpath, content, mode };
}

afterEach(() => {
  while (tmpDirs.length) {
    rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

describe("publish", () => {
  it("stages and atomically renames the file set into adaptersDir (no staging dir survives)", () => {
    const roots = makeRoots();
    const files = [
      file("claude/skills/foo/SKILL.md", "# foo\n"),
      file("codex/skills/foo/SKILL.md", "# foo codex\n"),
    ];

    publish(files, [], roots);

    expect(readFileSync(join(roots.adaptersDir, "claude/skills/foo/SKILL.md"), "utf8")).toBe(
      "# foo\n",
    );
    expect(readFileSync(join(roots.adaptersDir, "codex/skills/foo/SKILL.md"), "utf8")).toBe(
      "# foo codex\n",
    );
    // The staging dir does not survive a successful run.
    expect(() => statSync(`${roots.adaptersDir}.tmp-${process.pid}`)).toThrow();
  });

  it("publishes verbatim records byte-for-byte with no provenance header", () => {
    const roots = makeRoots();
    // Author the canonical source the verbatim record points at.
    mkdirSync(join(roots.repoRoot, "skills/foo/references"), { recursive: true });
    const refBody = "Verbatim reference body — copied exactly.\n";
    writeFileSync(join(roots.repoRoot, "skills/foo/references/ref.md"), refBody);

    const verbatim: VerbatimRecord[] = [
      {
        relpath: "claude/skills/foo/references/ref.md",
        sourcePath: "skills/foo/references/ref.md",
      },
    ];

    publish([], verbatim, roots);

    const written = readFileSync(
      join(roots.adaptersDir, "claude/skills/foo/references/ref.md"),
      "utf8",
    );
    expect(written).toBe(refBody); // byte-for-byte, no header prepended
  });

  it("removes stale committed adapter files no longer in the emitted set (REQ-EMIT-08)", () => {
    const roots = makeRoots();
    // First publish includes an old tool.
    publish(
      [
        file("claude/skills/old/SKILL.md", "# old\n"),
        file("claude/skills/keep/SKILL.md", "# keep\n"),
      ],
      [],
      roots,
    );
    expect(statSync(join(roots.adaptersDir, "claude/skills/old/SKILL.md")).isFile()).toBe(true);

    // Second publish drops the old tool — the whole-subtree swap removes it.
    publish([file("claude/skills/keep/SKILL.md", "# keep\n")], [], roots);

    expect(() => statSync(join(roots.adaptersDir, "claude/skills/old/SKILL.md"))).toThrow();
    expect(readFileSync(join(roots.adaptersDir, "claude/skills/keep/SKILL.md"), "utf8")).toBe(
      "# keep\n",
    );
  });

  it("is idempotent and byte-stable across two identical publishes (REQ-EMIT-05/06)", () => {
    const roots = makeRoots();
    const files = [file("claude/skills/foo/SKILL.md", "# foo\n", 0o644)];

    publish(files, [], roots);
    const target = join(roots.adaptersDir, "claude/skills/foo/SKILL.md");
    const first = readFileSync(target);
    const firstMode = statSync(target).mode & 0o777;

    publish(files, [], roots);
    const second = readFileSync(target);
    const secondMode = statSync(target).mode & 0o777;

    expect(second.equals(first)).toBe(true);
    expect(secondMode).toBe(firstMode);
  });

  it("throws PathEscapeError for a file path escaping the staging root and leaves adapters intact", () => {
    const roots = makeRoots();
    // Establish a prior good tree.
    publish([file("claude/skills/foo/SKILL.md", "# foo\n")], [], roots);

    expect(() => publish([file("../escape.md", "nope\n")], [], roots)).toThrow(PathEscapeError);

    // Fail-intact: the prior tree is untouched and no staging dir remains.
    expect(readFileSync(join(roots.adaptersDir, "claude/skills/foo/SKILL.md"), "utf8")).toBe(
      "# foo\n",
    );
    expect(() => statSync(`${roots.adaptersDir}.tmp-${process.pid}`)).toThrow();
  });
});
