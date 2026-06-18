# 08 — Testing Strategy

How the whole agent-agnostic scaffold is tested: the framework and layout, the
per-area unit suites, the determinism/drift/golden/schema suites that prove the
success criteria, the fixture and golden-file conventions, and the CI `gate` that
is the acceptance bar. This is the always-last document; it depends on every
preceding spec and ties **SC-01..SC-08** and **REQ-VALID-\*** to concrete tests.

All code targets **TypeScript on Bun (CON-01)** and uses **vitest** (`vitest run`),
co-located as `src/**/*.test.ts` with fixtures/goldens under `src/test/`. This
matches rauf (the project standard, tech-spec §3.1) — **not** `bun:test`. The
canonical rauf precedent for this exact pattern (vitest + `__fixtures__/` factories
+ co-located tests) is `/home/gary/workspace/rauf/scripts/release/lib.test.ts` and
its `__fixtures__/` directory.

## Requirement Coverage

| REQ / SC ID | Requirement | Section |
|-------------|-------------|---------|
| SC-01 | Add tool via canonical form + manifest + build, no adapter hand-edit | 9 (traceability), 4 |
| SC-02 | Sample tool emits correctly to all four targets + Claude | 6 (golden), 9 |
| SC-03 | Build twice → zero diff; drift guard passes (idempotent, byte-stable) | 5 |
| SC-04 | Hand-edit a committed adapter → drift guard fails; revert → passes | 5.2 |
| SC-05 | Declared override survives rebuild and is present in output | 5.3 |
| SC-05a | Removing a tool removes its adapters; orphan → drift guard fails | 5.2 |
| SC-06 | Each build produces a coverage report (mapped/fallback/skipped) | 4.5 |
| SC-07 | Claude side installable as a plugin | 6.4 |
| SC-08 | Golden-snapshot + schema-validation checks pass for all targets | 6, 7 |
| REQ-VALID-03 | Each emitted target validatable against its schema | 7 |
| REQ-VALID-04 | Golden-file snapshot tests | 6 |
| REQ-VALID-05 / REQ-OBS-01 | Coverage/capability report | 4.5 |
| REQ-VALID-01/02 / CON-05 | Drift guard runs locally + in CI, gates build | 5.2, 8 |
| REQ-DISC-03 | Manifest JSON Schema generated + drift-guarded | 7.2 |
| REQ-EMIT-05/06 / REQ-REL-01 | Idempotent, byte-stable emit | 5 |

## 1. Framework, layout & conventions

- **Runner**: `vitest run` (wired as the `test` package script,
  `01-architecture-layout.md` §3). `vitest.config.ts` is
  `{ test: { include: ["src/**/*.test.ts"] } }` (§4 of `01`).
- **Co-location**: every implementation module `src/X.ts` has a sibling
  `src/X.test.ts` for its unit suite. Cross-module/end-to-end suites
  (determinism, drift, golden) live under `src/test/`.
- **Shared assets** (`01` §2, `src/test/`):
  - `src/test/__fixtures__/` — tiny canonical trees + manifest factories (§3).
  - `src/test/__golden__/<target>/…` — checked-in expected sample-tool output (§6).
- **No hard coverage %** (CON-05, tech-spec §8). The acceptance bar is the `gate`
  script passing (§8), not a coverage threshold.
- **Imports** use the `.js` ESM specifier convention already used by the barrel
  (`01` §5), e.g. `import { emit } from "../emit.js"`.

All shared types referenced below (`Manifest`, `ToolEntry`, `EmitResult`,
`DriftEntry`, `DropRecord`, `ReportModel`, the error classes, `KEY_ORDER`,
`TARGET_ORDER`) are defined in `00-core-definitions.md` and are NOT redefined here.

## 2. Test taxonomy

| Suite | Location | Proves | Spec under test |
|-------|----------|--------|-----------------|
| Manifest validation | `src/manifest.test.ts` | REQ-DISC-03 | `02-manifest-and-config.md` |
| Frontmatter parse/serialize | `src/frontmatter.test.ts` | byte-stable round-trip | `03-discovery-and-canonical-model.md` |
| Discovery | `src/discover.test.ts` | source → records | `03-discovery-and-canonical-model.md` |
| Per-target transforms | `src/targets/<t>.test.ts` | REQ-EMIT-02/03 | `04-transforms.md` |
| Override merge | `src/overrides.test.ts` | REQ-EMIT-04, SC-05 | `05-overrides-publish-determinism.md` |
| Determinism / idempotency | `src/test/determinism.test.ts` | SC-03, REQ-EMIT-05/06 | `05-overrides-publish-determinism.md` |
| Drift / orphan guard | `src/test/driftguard.test.ts` | SC-04/05a, REQ-VALID-01 | `06-validation-and-drift-guard.md` |
| Coverage report | `src/report.test.ts` | SC-06, REQ-VALID-05 | `06-validation-and-drift-guard.md` |
| Schema validation | `src/test/schema.test.ts` | SC-08, REQ-VALID-03 | `06`, `07-packaging-and-sample-tool.md` |
| Golden snapshot | `src/test/golden.test.ts` | SC-02/08, REQ-VALID-04 | `07-packaging-and-sample-tool.md` |
| Plugin packaging | `src/plugin.test.ts` | SC-07, REQ-PKG-01 | `07-packaging-and-sample-tool.md` |
| JSON-Schema drift | `src/schema-gen.test.ts` | REQ-DISC-03 | `02-manifest-and-config.md` |

## 3. Fixtures & factories

Tiny canonical trees live under `src/test/__fixtures__/`. They are **deliberately
minimal** (one of each tool type) so unit assertions are exact, not the full sample
tool (that is the golden's job, §6). Factories write a temp canonical tree + a
matching `Manifest` and return resolved roots, mirroring rauf's
`makeRepoFixture`/`cleanupRepoFixtures` pattern.

```typescript
// src/test/__fixtures__/index.ts
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Manifest } from "../../model.js";
import type { z } from "zod";

/** Resolved absolute roots for a temp fixture repo. */
export interface FixtureRepo {
  root: string;
  manifestPath: string;
  manifest: z.infer<typeof Manifest>;
}

/** A minimal canonical skill: SKILL.md with name/description + body. */
export function skillDoc(name: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: A minimal ${name} skill for tests.`,
    "argument-hint: <topic>",
    "---",
    `# ${name}`,
    "",
    "Body text.",
    "",
  ].join("\n");
}

/** A minimal canonical agent with claude-only structural keys. */
export function agentDoc(name: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: A minimal ${name} agent.`,
    "tools: [Read, Write]",
    "model: opus",
    "---",
    `# ${name}`,
    "",
    "System prompt.",
    "",
  ].join("\n");
}

/** A minimal canonical slash command with argument-hint. */
export function commandDoc(name: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: A minimal ${name} command.`,
    "argument-hint: <arg>",
    "---",
    `Run ${name}.`,
    "",
  ].join("\n");
}

/**
 * Materialise a temp canonical repo with the given tool docs + a valid manifest.
 * Returns resolved absolute roots; caller must `cleanupFixtureRepo`.
 */
export function makeFixtureRepo(opts: {
  skills?: string[];
  agents?: string[];
  commands?: string[];
  /** Override files keyed by adapters-relative target path. */
  overrides?: Record<string, string>;
}): FixtureRepo {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scaffold-fix-"));
  const tools: z.infer<typeof Manifest>["tools"] = [];

  for (const name of opts.skills ?? []) {
    const dir = path.join(root, "skills", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "SKILL.md"), skillDoc(name));
    tools.push({ name, type: "skill", source: `skills/${name}/SKILL.md` });
  }
  for (const name of opts.agents ?? []) {
    fs.mkdirSync(path.join(root, "agents"), { recursive: true });
    fs.writeFileSync(path.join(root, "agents", `${name}.md`), agentDoc(name));
    tools.push({ name, type: "agent", source: `agents/${name}.md` });
  }
  for (const name of opts.commands ?? []) {
    fs.mkdirSync(path.join(root, "commands"), { recursive: true });
    fs.writeFileSync(path.join(root, "commands", `${name}.md`), commandDoc(name));
    tools.push({ name, type: "command", source: `commands/${name}.md` });
  }
  for (const [rel, content] of Object.entries(opts.overrides ?? {})) {
    const abs = path.join(root, "overrides", rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  const manifest = Manifest.parse({ version: 1, config: {}, tools });
  const manifestPath = path.join(root, "tools.manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return { root, manifestPath, manifest };
}

/** Remove a fixture repo created by makeFixtureRepo. */
export function cleanupFixtureRepo(repo: FixtureRepo): void {
  fs.rmSync(repo.root, { recursive: true, force: true });
}
```

> NOTE — `overrides` paths in `makeFixtureRepo` are keyed by their
> `<target>/<relpath>` form under `overrides/`, e.g.
> `"cursor/skills/sample/sample.mdc"`, matching the override layout in
> `05-overrides-publish-determinism.md`.

## 4. Per-area unit suites

### 4.1 Manifest Zod validation (`src/manifest.test.ts`, REQ-DISC-03)

Verifies `loadManifest` (`02-manifest-and-config.md`) accepts valid manifests and
throws `ManifestValidationError` (`00` §4) with a populated `issues` list on
invalid input. Uses inline JSON, not the fixture repo.

```typescript
import { describe, expect, it } from "vitest";
import { loadManifestFromString } from "../manifest.js"; // see 02 for exact export
import { ManifestValidationError } from "../errors.js";

describe("manifest validation", () => {
  it("accepts a minimal valid manifest and applies config defaults", () => {
    const m = loadManifestFromString(
      JSON.stringify({ version: 1, tools: [{ name: "x", type: "skill", source: "skills/x/SKILL.md" }] }),
    );
    expect(m.config.adaptersDir).toBe("adapters");
    expect(m.config.targets).toEqual(["claude", "codex", "copilot", "cursor", "gemini"]);
  });

  it("rejects a non-kebab tool name with ManifestValidationError", () => {
    expect(() =>
      loadManifestFromString(
        JSON.stringify({ version: 1, tools: [{ name: "Bad Name", type: "skill", source: "s" }] }),
      ),
    ).toThrow(ManifestValidationError);
  });

  it("rejects an unknown version and surfaces an issue path", () => {
    try {
      loadManifestFromString(JSON.stringify({ version: 2, tools: [] }));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ManifestValidationError);
      expect((e as ManifestValidationError).issues.join("\n")).toMatch(/version/);
    }
  });
});
```

> If `02-manifest-and-config.md` names its loader differently (e.g. `loadManifest`
> taking a path), bind these tests to that signature; the fixture's
> `manifestPath` supports the path form.

### 4.2 Frontmatter parse/serialize (`src/frontmatter.test.ts`)

Round-trip is the load-bearing property for byte-stability (REQ-EMIT-06). Asserts
parse → serialize preserves insertion order and that re-serialization under
`KEY_ORDER` + `YAML_OPTS` (`00` §5) is stable.

```typescript
import { describe, expect, it } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "../frontmatter.js"; // see 03
import { KEY_ORDER } from "../model.js";

describe("frontmatter", () => {
  it("round-trips a parsed doc byte-for-byte under fixed key order", () => {
    const src = "---\nname: x\ndescription: d\nargument-hint: <a>\n---\nbody\n";
    const parsed = parseFrontmatter(src);
    const out = serializeFrontmatter(parsed.frontmatter, parsed.body);
    expect(out).toBe(src);
  });

  it("emits keys in KEY_ORDER regardless of source order", () => {
    const src = "---\ndescription: d\nname: x\n---\nb\n";
    const parsed = parseFrontmatter(src);
    const out = serializeFrontmatter(parsed.frontmatter, parsed.body);
    const nameIdx = out.indexOf("name:");
    const descIdx = out.indexOf("description:");
    expect(nameIdx).toBeLessThan(descIdx);
    expect(KEY_ORDER.indexOf("name")).toBeLessThan(KEY_ORDER.indexOf("description"));
  });

  it("throws MalformedFrontmatterError on an unterminated block", () => {
    expect(() => parseFrontmatter("---\nname: x\nbody")).toThrow(/frontmatter/i);
  });
});
```

### 4.3 Discovery (`src/discover.test.ts`)

Confirms each `ToolEntry` is read into the correct record shape (`SkillRecord` /
`AgentRecord` / `CommandRecord`, `00` §3), that `SourceNotFoundError` fires for a
missing `source`, and POSIX-path sort ordering (tech-spec §3.6) is applied.

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { discover } from "../discover.js"; // see 03 for exact signature
import { SourceNotFoundError } from "../errors.js";
import { cleanupFixtureRepo, makeFixtureRepo } from "./__fixtures__"; // path: ../test/__fixtures__ from src/discover.test.ts

let repos: ReturnType<typeof makeFixtureRepo>[] = [];
afterEach(() => {
  repos.forEach(cleanupFixtureRepo);
  repos = [];
});

describe("discover", () => {
  it("reads a skill source into a SkillRecord", () => {
    const repo = makeFixtureRepo({ skills: ["sample"] });
    repos.push(repo);
    const records = discover(repo.manifest, repo.root);
    const skill = records.skills.find((s) => s.name === "sample");
    expect(skill?.description).toMatch(/minimal sample skill/);
  });

  it("throws SourceNotFoundError for a manifest entry with no file", () => {
    const repo = makeFixtureRepo({ skills: ["sample"] });
    repos.push(repo);
    repo.manifest.tools.push({ name: "ghost", type: "agent", source: "agents/ghost.md" });
    expect(() => discover(repo.manifest, repo.root)).toThrow(SourceNotFoundError);
  });
});
```

> Bind `discover`'s return shape to whatever `03-discovery-and-canonical-model.md`
> defines (e.g. a `DiscoveredRecords` aggregate). The fixture provides the inputs.

### 4.4 Per-target transforms (`src/targets/<target>.test.ts`, REQ-EMIT-02/03)

One suite per target module (`claude`, `codex`, `copilot`, `cursor`, `gemini`),
asserting against the transform table in `04-transforms.md` §5.2: skill/agent file
naming, **frontmatter shaping**, **fixed key order**, and **dropped keys** with a
matching `DropRecord` (`00` §3.4). The cursor case below is representative.

```typescript
import { describe, expect, it } from "vitest";
import { transformCursor } from "../cursor.js"; // see 04 for exact export
import type { SkillRecord, AgentRecord } from "../../model.js";

const skill: SkillRecord = {
  name: "sample",
  description: "A sample skill.",
  metadata: new Map([["argument-hint", "<topic>"]]),
  body: "# sample\n\nBody.\n",
  ownRefs: [],
  sourcePath: "skills/sample/SKILL.md",
};

describe("cursor transform", () => {
  it("emits skills/<n>/<n>.mdc with the cursor frontmatter shape", () => {
    const out = transformCursor.skill(skill);
    const file = out.files.find((f) => f.relpath.endsWith("sample.mdc"));
    expect(file).toBeDefined();
    // cursor frontmatter = { description, globs:[], alwaysApply:false } (04 §5.2)
    expect(file!.content).toMatch(/description:/);
    expect(file!.content).toMatch(/alwaysApply: false/);
    expect(file!.content).not.toMatch(/argument-hint/); // dropped for cursor
  });

  it("records a fallback DropRecord for the dropped argument-hint", () => {
    const out = transformCursor.skill(skill);
    expect(out.drops).toContainEqual(
      expect.objectContaining({ target: "cursor", kind: "fallback", construct: expect.stringContaining("argument-hint") }),
    );
  });

  it("drops agent claudeKeys with a record, never silently (REQ-EMIT-03)", () => {
    const agent: AgentRecord = {
      name: "a",
      description: "d",
      claudeKeys: new Map([["tools", ["Read"]], ["model", "opus"]]),
      body: "x",
      sourcePath: "agents/a.md",
    };
    const out = transformCursor.agent(agent);
    expect(out.drops.length).toBeGreaterThan(0);
    expect(out.drops.every((d) => d.kind === "fallback" || d.kind === "skipped")).toBe(true);
  });
});
```

Each target suite additionally asserts **provenance forms** (`00` §5 `PROVENANCE`,
`04` provenance section): Form A (YAML comment first line inside `---`), Form B
(HTML comment for `GENERATION-REPORT.md`), Form C (`_generated` first key in
`gemini-extension.json`). A dedicated case per form:

```typescript
it("prepends Form A provenance as the first frontmatter line", () => {
  const out = transformCursor.skill(skill);
  const file = out.files.find((f) => f.relpath.endsWith("sample.mdc"))!;
  const firstInner = file.content.split("\n")[1]; // line after opening ---
  expect(firstInner).toMatch(/^# GENERATED — DO NOT EDIT\./);
});
```

### 4.5 Coverage report (`src/report.test.ts`, SC-06, REQ-VALID-05, REQ-OBS-01)

Asserts `renderReport(ReportModel)` (`06-validation-and-drift-guard.md`) produces a
markdown report carrying every REQ-OBS-01 datum: targets emitted, tools processed,
fallbacks applied, items skipped, plus an `Overridden` section and a
`staleOverrides` listing (tech-spec §3.4).

```typescript
import { describe, expect, it } from "vitest";
import { renderReport } from "../report.js";
import type { ReportModel } from "../model.js";

const model: ReportModel = {
  toolsProcessed: [{ name: "sample", type: "skill" }],
  perTarget: {
    claude: { emitted: 1, fallback: 0, skipped: 0, overridden: 0, verbatim: 0 },
    codex: { emitted: 1, fallback: 1, skipped: 0, overridden: 0, verbatim: 0 },
    copilot: { emitted: 1, fallback: 1, skipped: 0, overridden: 0, verbatim: 0 },
    cursor: { emitted: 1, fallback: 1, skipped: 0, overridden: 1, verbatim: 0 },
    gemini: { emitted: 1, fallback: 1, skipped: 0, overridden: 0, verbatim: 0 },
  },
  drops: [{ target: "codex", source: "commands/sample.md", construct: "command:codex", kind: "fallback", reason: "no native slash command" }],
  staleOverrides: ["cursor/skills/removed/removed.mdc"],
};

describe("coverage report", () => {
  it("lists every processed tool and per-target tallies", () => {
    const md = renderReport(model);
    expect(md).toMatch(/sample/);
    expect(md).toMatch(/fallback/i);
  });

  it("surfaces stale overrides as a non-fatal section", () => {
    expect(renderReport(model)).toMatch(/removed\.mdc/);
  });

  it("opens with Form B HTML provenance comment", () => {
    expect(renderReport(model).startsWith("<!-- GENERATED")).toBe(true);
  });
});
```

## 5. Determinism, idempotency & drift suites

### 5.1 Determinism / idempotency (`src/test/determinism.test.ts`, SC-03, REQ-EMIT-05/06)

Two load-bearing properties: **emit twice → zero diff**, and **emit then
`build --check` → clean**. Both run the real `emit`/`driftCheck`
(`01` §5 barrel exports) against a fixture repo.

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { emit, driftCheck } from "../../index.js";
import { cleanupFixtureRepo, makeFixtureRepo } from "../__fixtures__";

let repos: ReturnType<typeof makeFixtureRepo>[] = [];
afterEach(() => {
  repos.forEach(cleanupFixtureRepo);
  repos = [];
});

/** Snapshot every emitted file's path+content as a sortable string. */
function snapshot(files: { relpath: string; content: string }[]): string {
  return [...files]
    .sort((a, b) => a.relpath.localeCompare(b.relpath))
    .map((f) => `${f.relpath}\n${f.content}`)
    .join("\n--FILE--\n");
}

describe("determinism (SC-03)", () => {
  it("two emits over unchanged input produce byte-identical output", () => {
    const repo = makeFixtureRepo({ skills: ["sample"], agents: ["helper"], commands: ["go"] });
    repos.push(repo);
    const a = emit(repo.manifest, repo.root);
    const b = emit(repo.manifest, repo.root);
    expect(snapshot(b.files)).toBe(snapshot(a.files));
  });

  it("emit then driftCheck reports no drift entries", () => {
    const repo = makeFixtureRepo({ skills: ["sample"] });
    repos.push(repo);
    // emit publishes adapters/ into repo.root (see 05 publish.ts)
    emit(repo.manifest, repo.root);
    const drift = driftCheck(repo.manifest, repo.root);
    expect(drift).toEqual([]);
  });
});
```

> `emit`/`driftCheck` here are the barrel exports (`01` §5). If `emit` returns an
> in-memory `EmitResult` without writing, the second test calls the publish step
> from `05-overrides-publish-determinism.md` first; bind to whatever the publish
> contract in `05` specifies. The property (zero drift after a clean emit) is fixed.

### 5.2 Drift / orphan guard (`src/test/driftguard.test.ts`, SC-04, SC-05a, REQ-VALID-01)

Proves the guard fails on (a) a hand-edited committed adapter → `DriftEntry`
`kind: "content"`; (b) a tool removed from the manifest leaving a committed adapter
→ `kind: "orphan"`; and that reverting the edit makes it pass (SC-04). The guard
throws `DriftError` carrying `entries: DriftEntry[]` (`00` §4 / §3.6).

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emit, driftCheck } from "../../index.js";
import { DriftError } from "../../errors.js";
import { cleanupFixtureRepo, makeFixtureRepo } from "../__fixtures__";

let repos: ReturnType<typeof makeFixtureRepo>[] = [];
afterEach(() => {
  repos.forEach(cleanupFixtureRepo);
  repos = [];
});

/** Locate one emitted adapter file path on disk for a target. */
function anyAdapterFile(root: string, target: string): string {
  const base = path.join(root, "adapters", target);
  const walk = (d: string): string[] =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
    );
  return walk(base)[0]!;
}

describe("drift guard (SC-04)", () => {
  it("fails with kind:content when a committed adapter is hand-edited", () => {
    const repo = makeFixtureRepo({ skills: ["sample"] });
    repos.push(repo);
    emit(repo.manifest, repo.root);
    const file = anyAdapterFile(repo.root, "cursor");
    fs.appendFileSync(file, "\nhand edit\n");

    const drift = driftCheck(repo.manifest, repo.root);
    expect(drift.some((d) => d.kind === "content")).toBe(true);
  });

  it("passes again once the edit is reverted (re-emit)", () => {
    const repo = makeFixtureRepo({ skills: ["sample"] });
    repos.push(repo);
    emit(repo.manifest, repo.root);
    fs.appendFileSync(anyAdapterFile(repo.root, "cursor"), "\nhand edit\n");
    emit(repo.manifest, repo.root); // re-emit overwrites the hand edit
    expect(driftCheck(repo.manifest, repo.root)).toEqual([]);
  });
});

describe("orphan detection (SC-05a)", () => {
  it("flags a committed adapter with no canonical source as kind:orphan", () => {
    const repo = makeFixtureRepo({ skills: ["sample", "doomed"] });
    repos.push(repo);
    emit(repo.manifest, repo.root); // commits adapters for both skills
    // remove "doomed" from the manifest but leave its committed adapters in place
    repo.manifest.tools = repo.manifest.tools.filter((t) => t.name !== "doomed");

    const drift = driftCheck(repo.manifest, repo.root);
    expect(drift.some((d) => d.kind === "orphan" && d.relpath.includes("doomed"))).toBe(true);
  });

  it("a rebuild removes the orphaned adapter files (stale cleanup, REQ-EMIT-08)", () => {
    const repo = makeFixtureRepo({ skills: ["sample", "doomed"] });
    repos.push(repo);
    emit(repo.manifest, repo.root);
    repo.manifest.tools = repo.manifest.tools.filter((t) => t.name !== "doomed");
    emit(repo.manifest, repo.root); // atomic re-publish drops the whole subtree
    const exists = fs.existsSync(path.join(repo.root, "adapters", "cursor", "skills", "doomed"));
    expect(exists).toBe(false);
  });
});

describe("DriftError shape", () => {
  it("carries typed DriftEntry[] so the CLI can print which files and how", () => {
    const repo = makeFixtureRepo({ skills: ["sample"] });
    repos.push(repo);
    emit(repo.manifest, repo.root);
    fs.appendFileSync(anyAdapterFile(repo.root, "cursor"), "\nx\n");
    // cli.ts wraps driftCheck non-empty result in DriftError (06)
    const drift = driftCheck(repo.manifest, repo.root);
    const err = new DriftError("drift", drift);
    expect(err.code).toBe("DRIFT_DETECTED");
    expect(err.entries.length).toBeGreaterThan(0);
  });
});
```

### 5.3 Override survival & distinguishability (`src/overrides.test.ts`, SC-05, REQ-EMIT-04)

Proves a declared override (a) is present in the target's output, (b) survives a
rebuild unclobbered, (c) makes `driftCheck` pass (legitimate author content, not
drift), and (d) a **stale** override yields a non-fatal `staleOverrides` warning,
never a thrown error (tech-spec §7; `00` §4 note).

```typescript
import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { emit, driftCheck } from "../index.js";
import { cleanupFixtureRepo, makeFixtureRepo } from "./__fixtures__";

let repos: ReturnType<typeof makeFixtureRepo>[] = [];
afterEach(() => {
  repos.forEach(cleanupFixtureRepo);
  repos = [];
});

const OVERRIDE_REL = "cursor/skills/sample/sample.mdc";
const OVERRIDE_BODY = "---\ndescription: hand authored\nalwaysApply: true\n---\nCustom.\n";

describe("override slots (SC-05)", () => {
  it("overlays author content into the target output and survives rebuild", () => {
    const repo = makeFixtureRepo({ skills: ["sample"], overrides: { [OVERRIDE_REL]: OVERRIDE_BODY } });
    repos.push(repo);
    emit(repo.manifest, repo.root);
    emit(repo.manifest, repo.root); // rebuild must NOT clobber the override
    const onDisk = fs.readFileSync(
      path.join(repo.root, "adapters", "cursor", "skills", "sample", "sample.mdc"),
      "utf8",
    );
    expect(onDisk).toBe(OVERRIDE_BODY);
  });

  it("driftCheck passes — an override is not drift", () => {
    const repo = makeFixtureRepo({ skills: ["sample"], overrides: { [OVERRIDE_REL]: OVERRIDE_BODY } });
    repos.push(repo);
    emit(repo.manifest, repo.root);
    expect(driftCheck(repo.manifest, repo.root)).toEqual([]);
  });

  it("overridden files carry NO provenance header (author content, §3.4)", () => {
    const repo = makeFixtureRepo({ skills: ["sample"], overrides: { [OVERRIDE_REL]: OVERRIDE_BODY } });
    repos.push(repo);
    const result = emit(repo.manifest, repo.root);
    expect(result.overridden).toContain(OVERRIDE_REL);
    const file = result.files.find((f) => f.relpath === "cursor/skills/sample/sample.mdc")!;
    expect(file.content).not.toMatch(/GENERATED — DO NOT EDIT/);
  });

  it("a stale override is a non-fatal warning, not a throw", () => {
    const repo = makeFixtureRepo({
      skills: ["sample"],
      overrides: { "cursor/skills/gone/gone.mdc": "x" }, // no canonical 'gone'
    });
    repos.push(repo);
    let result!: ReturnType<typeof emit>;
    expect(() => {
      result = emit(repo.manifest, repo.root);
    }).not.toThrow();
    // staleOverrides surfaced via the report model (06 / 00 §3.5)
    // assert through the rendered report or the EmitResult→ReportModel mapping in 06
    expect(JSON.stringify(result)).toMatch(/gone/);
  });
});
```

> The exact `staleOverrides` plumbing (whether it rides on `EmitResult` or only the
> `ReportModel`) is fixed in `06-validation-and-drift-guard.md`; bind the last
> assertion to that. The invariant — **no throw, surfaced as a warning** — is fixed
> here and in `00` §4.

## 6. Golden snapshot tests (`src/test/golden.test.ts`, REQ-VALID-04, SC-02, SC-08)

The MVP **sample skill** (defined in `07-packaging-and-sample-tool.md`) is emitted
to all five targets and asserted **byte-equal** against checked-in goldens. This is
a focused transform-regression test on the real sample tool, complementing the
whole-tree drift guard (tech-spec §3.7).

### 6.1 Golden fixture layout

```
src/test/
  __golden__/
    claude/   …/SKILL.md, agents/…, commands/…
    codex/    …/<n>.md, agents/openai.yaml
    copilot/  …/<n>.md
    cursor/   …/<n>.mdc
    gemini/   …/<n>.md, gemini-extension.json
```

The golden tree mirrors `adapters/<target>/` exactly for the sample tool's files
(and its aggregate manifests). Goldens are **checked in** (CON-02 spirit) and
reviewed as ordinary diffs.

### 6.2 The sample-tool source

The sample skill's canonical source is the one selected in
`07-packaging-and-sample-tool.md` (OQ-04). The golden test reads that **committed
canonical source from the repo root** (not a temp fixture) plus a manifest entry
for it, emits, and compares. This keeps the golden anchored to the shipped sample.

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { emit } from "../../index.js";
import { loadManifest } from "../../manifest.js";

const REPO_ROOT = path.resolve(__dirname, "../../.."); // src/test → repo root
const GOLDEN_ROOT = path.resolve(__dirname, "__golden__");
const SAMPLE = "sample"; // the OQ-04 sample skill name (07)

/** Read all golden files for a target as relpath→content. */
function readGolden(target: string): Map<string, string> {
  const base = path.join(GOLDEN_ROOT, target);
  const out = new Map<string, string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out.set(path.relative(base, abs), fs.readFileSync(abs, "utf8"));
    }
  };
  walk(base);
  return out;
}

describe("golden snapshot — sample skill (SC-02, REQ-VALID-04)", () => {
  const manifest = loadManifest(path.join(REPO_ROOT, "tools.manifest.json"));
  const result = emit(manifest, REPO_ROOT);

  for (const target of ["claude", "codex", "copilot", "cursor", "gemini"]) {
    it(`emits ${target} byte-equal to the golden`, () => {
      const golden = readGolden(target);
      const emitted = new Map(
        result.files
          .filter((f) => f.relpath.startsWith(`${target}/`))
          .filter((f) => f.relpath.includes(SAMPLE) || f.relpath.endsWith(".yaml") || f.relpath.endsWith(".json"))
          .map((f) => [f.relpath.slice(target.length + 1), f.content]),
      );
      for (const [rel, content] of golden) {
        expect(emitted.get(rel), `missing/changed: ${target}/${rel}`).toBe(content);
      }
      // every golden file is accounted for
      expect([...emitted.keys()].sort()).toEqual(
        expect.arrayContaining([...golden.keys()]),
      );
    });
  }
});
```

### 6.3 Generating / regenerating goldens

- Goldens are produced by running the **real emit** on the committed sample source
  and copying `adapters/<target>/<sample-files>` into `src/test/__golden__/<target>/`.
- A maintainer regenerates them with an explicit, reviewed step (e.g. a
  `bun run src/cli.ts build` followed by a copy script, or a documented
  `UPDATE_GOLDENS=1 vitest run` mode if `07` defines one). Regeneration is a
  **deliberate** act — goldens are never auto-overwritten on a normal test run, so
  an unintended transform change shows up as a failing assertion (REQ-VALID-04).
- Because the goldens are byte-exact, **byte-stable serialization is mandatory**
  (`00` §5 `YAML_OPTS`, `KEY_ORDER`). See the WARNING in §10 regarding TOML.

### 6.4 Plugin packaging (`src/plugin.test.ts`, SC-07, REQ-PKG-01)

Asserts `emitPlugin` (`07-packaging-and-sample-tool.md`) writes a
`.claude-plugin/plugin.json` + `marketplace.json` whose shapes match
feature-forge's manifests, and that the Claude adapter plus plugin manifest form a
self-consistent installable bundle (the sample tool appears in the plugin's tool
listing). A schema-shape check (no missing required keys) stands in for an actual
install.

```typescript
import { describe, expect, it } from "vitest";
import { emitPlugin } from "../plugin.js"; // see 07 for exact export
import { makeFixtureRepo, cleanupFixtureRepo } from "./test/__fixtures__"; // adjust to actual path

describe("plugin packaging (SC-07)", () => {
  it("produces plugin.json with required manifest keys", () => {
    const repo = makeFixtureRepo({ skills: ["sample"] });
    const out = emitPlugin(repo.manifest, repo.root);
    const plugin = out.files.find((f) => f.relpath.endsWith("plugin.json"))!;
    const json = JSON.parse(plugin.content);
    expect(json).toHaveProperty("name");
    expect(json).toHaveProperty("version");
    cleanupFixtureRepo(repo);
  });
});
```

> Bind `emitPlugin`'s signature/return and the exact required keys to
> `07-packaging-and-sample-tool.md`.

## 7. Schema-validation tests (REQ-VALID-03, REQ-DISC-03, SC-08)

### 7.1 Emitted target manifests (`src/test/schema.test.ts`, REQ-VALID-03)

The codex `agents/openai.yaml` and gemini `gemini-extension.json` aggregates
(`04`/`05`) must validate against each target's expected shape. The expected shapes
are the Zod/JSON-Schema validators defined in `06-validation-and-drift-guard.md`
(§ schema-validation). This suite parses the emitted aggregate and runs the
validator.

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { emit } from "../../index.js";
import { OpenAiYamlShape, GeminiExtensionShape } from "../../targets/index.js"; // schemas, see 06
import { cleanupFixtureRepo, makeFixtureRepo } from "../__fixtures__";

let repos: ReturnType<typeof makeFixtureRepo>[] = [];
afterEach(() => {
  repos.forEach(cleanupFixtureRepo);
  repos = [];
});

describe("emitted manifest schemas (REQ-VALID-03)", () => {
  it("codex openai.yaml validates against the expected shape", () => {
    const repo = makeFixtureRepo({ agents: ["helper"] });
    repos.push(repo);
    const result = emit(repo.manifest, repo.root);
    const file = result.files.find((f) => f.relpath === "codex/agents/openai.yaml")!;
    expect(() => OpenAiYamlShape.parse(parseYaml(file.content))).not.toThrow();
  });

  it("gemini gemini-extension.json validates and leads with _generated", () => {
    const repo = makeFixtureRepo({ skills: ["sample"] });
    repos.push(repo);
    const result = emit(repo.manifest, repo.root);
    const file = result.files.find((f) => f.relpath === "gemini/gemini-extension.json")!;
    const json = JSON.parse(file.content);
    expect(Object.keys(json)[0]).toBe("_generated"); // Form C provenance (00 §5 / 04)
    expect(() => GeminiExtensionShape.parse(json)).not.toThrow();
  });
});
```

> `OpenAiYamlShape` / `GeminiExtensionShape` are the validators owned by
> `06-validation-and-drift-guard.md`; this suite consumes them. If `06` names or
> locates them differently, bind to that.

### 7.2 Manifest JSON-Schema drift (`src/schema-gen.test.ts`, REQ-DISC-03)

`schema:check` (`01` §3, `02`) regenerates `schemas/tools.manifest.schema.json`
from the Zod `Manifest` via `zod-to-json-schema` and diffs against the committed
file (rauf's `generate-json-schemas.ts --check` pattern, tech-spec §3.3). The unit
test asserts the generated schema equals the committed one byte-for-byte.

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { generateManifestSchema } from "../schema-gen.js"; // see 02 for exact export

describe("manifest JSON-Schema (REQ-DISC-03)", () => {
  it("committed schema matches a fresh generation (schema:check)", () => {
    const generated = generateManifestSchema(); // string, stable-serialized
    const committed = fs.readFileSync(
      path.resolve(__dirname, "../schemas/tools.manifest.schema.json"),
      "utf8",
    );
    expect(generated).toBe(committed);
  });
});
```

## 8. The `gate` script is the acceptance bar (CON-05)

There is **no hard coverage percentage** (tech-spec §8). CI runs the `gate` script
from `01-architecture-layout.md` §3:

```
compile → schema:check → typecheck → lint → format:check → test → build:check
```

- `test` runs every vitest suite in §4–§7.
- `schema:check` enforces §7.2 at the script level.
- `build:check` (the drift guard) enforces §5.2 over the **whole committed
  `adapters/` tree**, not just fixtures — this is the CI-mandated guard (CON-05,
  REQ-VALID-02). `build:check` is intentionally **last** so a green gate proves the
  committed adapters match the canonical source.

A failing gate on any step fails CI. This is the single bar SC-01..SC-08 are
verified against.

## 9. Traceability: SC → tests

| SC | Proven by |
|----|-----------|
| SC-01 (author once + build, no hand-edit) | §4.1 manifest accepts a new entry; §5.1 emit produces adapters with no manual step; whole-flow `gate` (§8) |
| SC-02 (sample emits to all four + Claude) | §6 golden suite asserts byte-equal output per target |
| SC-03 (build twice → zero diff; guard passes) | §5.1 determinism: two-emit equality + post-emit `driftCheck` clean |
| SC-04 (hand-edit fails guard; revert passes) | §5.2 `kind:"content"` drift + revert-passes case |
| SC-05 (override survives + present) | §5.3 override survival + driftCheck-passes cases |
| SC-05a (removal cleans up; orphan fails guard) | §5.2 orphan detection + stale-cleanup cases |
| SC-06 (coverage report per build) | §4.5 report suite; report emitted by every `emit` |
| SC-07 (Claude installable as plugin) | §6.4 plugin manifest shape suite |
| SC-08 (golden + schema checks pass) | §6 golden + §7 schema suites; enforced by `gate` |

## Dependencies

This document tests the behaviour specified by **all** preceding spec documents and
must be implemented after them:

- `00-core-definitions.md` — all shared types, errors, constants asserted here.
- `01-architecture-layout.md` — `vitest.config.ts`, `src/test/` layout, package
  scripts, the `gate` script (§8).
- `02-manifest-and-config.md` — manifest loader + `schema-gen` under test (§4.1, §7.2).
- `03-discovery-and-canonical-model.md` — frontmatter + discovery under test (§4.2/4.3).
- `04-transforms.md` — per-target transforms + provenance under test (§4.4).
- `05-overrides-publish-determinism.md` — `emit`/publish/overrides + determinism
  contracts under test (§5).
- `06-validation-and-drift-guard.md` — `driftCheck`, `renderReport`, and the
  target-manifest validators (`OpenAiYamlShape`, `GeminiExtensionShape`) under test
  (§4.5, §5.2, §7).
- `07-packaging-and-sample-tool.md` — the MVP sample skill + goldens + `emitPlugin`
  (§6).

## Verification

- [ ] `bun run test` runs all suites in §4–§7 green on a clean tree.
- [ ] `bun run gate` passes end-to-end; `build:check` (last step) reports no drift
      over the committed `adapters/` tree (CON-05).
- [ ] Removing `argument-hint` shaping from any target transform makes the matching
      §4.4 case AND the §6 golden fail (regression coverage is real, not vacuous).
- [ ] Hand-editing a committed adapter then running `bun run build:check` exits
      non-zero with a `content` `DriftEntry`; reverting makes it pass (SC-04).
- [ ] Removing a tool from `tools.manifest.json` and running `build:check` reports
      an `orphan`; a `build` then cleans it (SC-05a).
- [ ] Regenerating goldens after an intentional transform change is a deliberate,
      reviewed diff — goldens never auto-update on a plain `vitest run`.
- [ ] `schemas/tools.manifest.schema.json` equals a fresh `schema:gen` output (§7.2).

## Cross-cutting WARNING — byte-stable TOML serializer not yet in deps

`04-transforms.md`/`05-overrides-publish-determinism.md` may emit **Codex agents
(TOML)** and/or **Gemini commands (TOML)** depending on the slash-command formats
finalised in those docs (tech-spec §3.5, TQ-1). Byte-stable golden tests (§6) and
the drift guard (§5.2) require a **deterministic, byte-stable TOML serializer at
runtime**. `package.json` (`01` §3) currently lists only `zod`,
`zod-to-json-schema`, and `yaml` as runtime deps — **there is no TOML library**.

ACTION FOR IMPLEMENTER: if any target emits TOML, add a byte-stable TOML serializer
(e.g. `smol-toml` or `@iarna/toml`) to `dependencies` and pin its serialization
options for stable key order, exactly as `YAML_OPTS` does for YAML (`00` §5).
Without this, the TOML golden snapshots in §6 and the determinism guarantee
(REQ-EMIT-06) are **not achievable**. Verify the chosen library produces identical
bytes across runs before checking in any TOML golden.
