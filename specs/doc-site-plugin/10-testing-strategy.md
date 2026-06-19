# 10 — Testing Strategy

How `doc-site-plugin` is **proven** to meet its build-time equivalence bar and its
in-repo proof obligations. This feature ships **no `src/` production module** — it
is a canonical skill (markdown + parameterized template assets) emitted by the
existing `agent-agnostic-scaffold` pipeline (`00-core-definitions.md`,
`01-architecture-layout.md §3`). Consequently every test here is a **verification
test** under the repo's existing `test` gate stage; this document adds tests,
fixtures, and checked-in golden trees, but **no new gate stage and no new emitter
code** (tech-spec §2, §8; `01 §3`).

## In-repo vs target-repo split (read this first)

The PRD draws a hard line that this document respects:

- **Runtime smoke test (REQ-VERIFY-01)** — the emitted Astro/Starlight build,
  `setup-docs.sh` content setup, and real end-to-end diagram generation
  (REQ-DIAG-03) — runs **at scaffold time inside the target repo**, driven by the
  agent. It cannot run in `agent-docs` CI: there is no scaffolded target tree, no
  resolved Astro install, and no live interview here. That runtime obligation is
  specified in `08-rerun-and-verification.md` (the target-side build-success
  contract), **not** in this document. This document explicitly does **not**
  attempt to build a Starlight site.
- **Build-time equivalence (REQ-PORT-02)** — given identical interview answers, the
  emitted file set is byte-identical across all five agent targets — **is** an
  `agent-docs` CI obligation and is proven exhaustively here (§3) plus by the
  whole-tree `build --check` drift guard (§3.1).

What `agent-docs` CI **can** assert, and what this document covers:

1. The skill's own files (`SKILL.md`, `references/**`) emit
   byte-identically to all five targets (REQ-PORT-02 *for the tool itself*) — §3.
2. The `{{TOKEN}}` vocabulary in `00 §4.1` / SKILL.md and `references/templates/**`
   are in exact mutual agreement (no orphan/undefined tokens) — §4.
3. The hand-authored static `references/docs.manifest.schema.json` (`00 §2.4`) is a
   valid JSON Schema that **accepts** valid manifest fixtures and **rejects**
   invalid ones — §4.
4. The `{{TOKEN}}` substitution **procedure** is deterministic and agent-agnostic
   — proven without a live agent by applying fixed interview-answer sets to the
   real templates and diffing against checked-in resolved outputs (§5), including
   the **decline-all → zero files** invariant for declined components
   (REQ-USE-01, `00 §5`) — §5.4.

## Requirement Coverage

Each row maps a requirement (or its in-repo proof obligation) to the test section
that proves it. Runtime-only rows are marked as covered by `08`.

| REQ / decision ID                          | In-repo proof obligation                                                            | Test section |
| ------------------------------------------ | ----------------------------------------------------------------------------------- | ------------ |
| REQ-PORT-02 (tool itself)                  | Skill files emit byte-identical to all 5 targets (exhaustive + representative spot)  | 3, 3.1, 3.2  |
| REQ-PORT-02 (scaffolded output)            | Substitution procedure deterministic / agent-agnostic — fixture goldens             | 5            |
| REQ-USE-01                                 | Decline-all interview set → only the core scaffold; zero files for declined groups  | 5.4          |
| REQ-CONTENT-01/04 (`source` field)         | Manifest schema accepts symlink/native/mixed; `from` required iff `source:symlink`  | 4.3          |
| REQ-CONTENT-03 (single manifest)           | Schema is strict (`additionalProperties:false`); rejects unknown keys, dup slugs    | 4.3          |
| OQ-2 (`unmanaged` escape hatch)            | Schema accepts `unmanaged:true` without `source`/`from`                             | 4.3          |
| REQ-CORE-01/02/03 (core scaffold tokens)   | Every core token exercised by ≥1 scaffold fixture; `SITE`/`BASE_PATH`, accents      | 5.2, 6       |
| REQ-CONTENT-02 (symlinker)                 | symlink-mode fixture resolves `setup-docs.sh` byte-exact                            | 5.2          |
| (token vocabulary, `00 §4`)                | Every `{{TOKEN}}` in templates is documented and vice-versa (no orphan/undefined)   | 4.2          |
| REQ-VERIFY-01 / REQ-DIAG-03 (runtime)      | Covered by `08-rerun-and-verification.md` (target-repo, not `agent-docs` CI)         | 2 (note)     |

## 1. Test layout & runner

The suite runs under the repo's existing runner — `vitest run` (the `package.json`
`"test"` script, verified at `package.json:25` — `"test": "vitest run"`), with **no
new framework**. It is wired into `gate` only through that existing `test` stage
(`package.json:26`); `00 §2`, `01 §3`, and tech-spec §6 all forbid a new gate
stage because the docs.manifest schema is a static asset, not a `schema-gen`
output.

Test files are co-located under `src/test/` (mirroring `src/test/golden.test.ts`,
`src/test/driftguard.test.ts`), with fixtures and golden trees alongside (`01 §1`):

```
src/test/
  golden.shared.ts                 # EXISTING — add doc-site-plugin SAMPLE_RELPATHS rows (§3.2, 09 §3)
  golden.test.ts                   # EXISTING — byte-exact assertion over the added rows (§3.2)
  __golden__/<target>/…            # EXISTING tree — add regenerated doc-site representative goldens (§3.2)

  doc-site-templates.test.ts       # NEW — token-coverage (§4.2) + schema-fixture validation (§4.3)
  doc-site-scaffold.test.ts        # NEW — scaffold-output golden fixtures (§5)

  doc-site/
    fixtures.ts                    # NEW — interview-answer sets + manifest fixtures (§5.1, §4.3) lives under __fixtures__
  __fixtures__/doc-site/           # NEW — interview-answer sets + valid/invalid manifest JSON (§4.3, §5.1)
    answers/
      single-symlink.json
      monorepo-mixed.json
      decline-all.json
    manifests/
      valid-minimal.json   valid-mixed.json   valid-unmanaged.json
      invalid-symlink-missing-from.json   invalid-native-with-from.json
      invalid-unknown-key.json   invalid-duplicate-slug.json   invalid-missing-source.json
  __scaffold_golden__/             # NEW — checked-in resolved scaffold outputs per answer set (§5)
    single-symlink/…   monorepo-mixed/…   decline-all/…
  regenerate-scaffold-goldens.ts   # NEW — DELIBERATE writer for __scaffold_golden__ (§5.3)
```

The skill-emission proof (§3) reuses the **existing** emitter golden machinery
(`golden.shared.ts` + `golden.test.ts` + the whole-tree `build --check` drift
guard) rather than adding a doc-site-local emission test, exactly as
`diagram-generator` did (`specs/diagram-generator/08-testing-strategy.md §8`,
`09-integration-and-emission.md §3`).

## 2. Why no runtime build test lives here

The single most expensive proof — that the emitted site actually builds green
(REQ-VERIFY-01) and that diagram generation runs end-to-end (REQ-DIAG-03) — is a
**target-repo, scaffold-time** obligation. It is impossible in `agent-docs` CI for
three concrete reasons:

1. There is no scaffolded target tree in `agent-docs`; the templates are `.tmpl`
   assets, not a resolved Astro package.
2. Astro/Starlight are resolved to **latest at scaffold time** (REQ-REL-02,
   `00 §4.1` `{{ASTRO_VERSION}}`) and are **not** dependencies of `agent-docs`
   (tech-spec §9 — "No new external dependency is added to `agent-docs`").
3. The interview is a live, agent-driven conversation (CON-03); there is no
   interview to run in CI.

Therefore REQ-VERIFY-01 / REQ-VERIFY-02 / REQ-DIAG-03 are owned by
`08-rerun-and-verification.md` (the target-side build-success + remediation
contract). This document instead proves the **deterministic, build-time** half: the
exact bytes the agent will write are a pure function of the answers (§5), so a green
target build is reproducible across agents. The split mirrors `08`'s sibling
(`specs/diagram-generator/08-testing-strategy.md §10`), which likewise carves the
non-deterministic LLM-driven step out of the Vitest scope.

## 3. Skill-emission proof — REQ-PORT-02 for the tool itself

REQ-PORT-02 for the *tool* is "the `doc-site-plugin` skill files emit
byte-identically to all five agent targets." This is proven by **two complementary
layers** already present in the repo (tech-spec §8 item 1):

- **Exhaustive** — the whole-tree `build --check` drift guard (§3.1).
- **Fast representative spot-check** — the `SAMPLE_RELPATHS` golden test (§3.2).

### 3.1 Whole-tree drift gate — `build --check` (`src/driftguard.ts`)

`build --check` (the `build:check` script, `package.json:13` —
`"build:check": "bun run src/cli.ts build --check"`) calls `driftCheck`
(`src/driftguard.ts`), which re-emits the **complete** adapter tree in memory via
the same `emit()` pipeline a real build uses, then diffs it against the committed
`adapters/<target>/…` tree, throwing `DriftError`
(`src/errors.ts`, `code: "DRIFT_DETECTED"`) on **any** difference. Because the
skill's `references/**` ride **verbatim** to every target
(`skillVerbatimRecords()`, `src/targets/_shared.ts:226`; `01 §5.1`), this guard is
the authoritative, exhaustive byte-identity proof that **every** `.tmpl` asset, the
static schema asset, and `favicon.svg` are byte-identical across all five
`adapters/`. It runs in `gate` after `test` (`package.json:26`).

No new code is needed for this layer: adding the `doc-site-plugin` `ToolEntry` to
`tools.manifest.json` (`09-integration-and-emission.md §2`) and committing its
`adapters/` subtree brings it under `driftCheck`'s walk automatically. The
`driftguard.test.ts` suite (verified: it exercises `driftCheck` over a fixture
repo, asserting clean→`[]`, hand-edit→`kind:"content"`, removed-tool→`kind:"orphan"`)
already proves the guard's mechanics; doc-site-plugin only needs to ride it.

### 3.2 Representative golden spot-check — `SAMPLE_RELPATHS` + `golden.test.ts`

The existing `golden.test.ts` asserts a fast, **representative** subset of emitted
files byte-exact per target, complementing the whole-tree guard with a tight,
readable diff on transform regressions. It iterates `SAMPLE_RELPATHS`
(`src/test/golden.shared.ts:42`, a `Record<Target, string[]>`) and does
**bidirectional set equality** plus byte-exact content per file (verified:
`golden.test.ts:70-78`).

**Add these representative relpaths** to `SAMPLE_RELPATHS` — one transformed entry
(`SKILL.md`) per target, exercising every per-target transform shape, plus the
verbatim-asset spot-check. Per the scope note in `golden.shared.ts:30-41`, the
golden suite asserts `emit().files` (the **transformed** outputs); verbatim owned
subtrees (`references/**`) live in `emit().verbatim` and are pinned by
`build --check` (§3.1), **not** registered in `SAMPLE_RELPATHS`. So the registered
rows are the per-target `SKILL.md` transform only:

| Target  | doc-site relpath to add to `SAMPLE_RELPATHS`              | Source rule |
| ------- | -------------------------------------------------------- | ----------- |
| claude  | `skills/doc-site-plugin/SKILL.md`                        | `01 §5.2`   |
| codex   | `skills/doc-site-plugin/SKILL.md`                        | `01 §5.2`   |
| gemini  | `skills/doc-site-plugin/doc-site-plugin.md` (+ existing `gemini-extension.json` aggregate is unchanged) | `01 §5.2` |
| cursor  | `rules/doc-site-plugin.mdc`                              | `01 §5.2`   |
| copilot | `instructions/doc-site-plugin.instructions.md`           | `01 §5.2`   |

> The byte-identity of the **template assets and the static schema** is the
> load-bearing REQ-PORT-02 claim; that is guaranteed by `build --check` (§3.1)
> because those files ride verbatim. The `SAMPLE_RELPATHS` rows give the fast,
> reviewable spot-check on the one file that is per-target *transformed* (the
> `SKILL.md` front-matter/format), which is where a transform regression would
> surface. Together: `build --check` = exhaustive; goldens = fast representative.

No new test file is added for §3 — it extends `golden.shared.ts` (data) and relies
on the existing `golden.test.ts` + `build --check`. Goldens are regenerated
deliberately via the existing `bun run src/test/regenerate-goldens.ts`
(`golden.test.ts:15`: "Goldens never auto-update on a plain `vitest run`").

## 4. Template-asset validation — `doc-site-templates.test.ts` (NEW)

This file proves the two static-asset contracts that have no runtime build to lean
on (tech-spec §8 item 2): the token vocabulary is closed and consistent (§4.2), and
the hand-authored schema is valid and discriminating (§4.3).

### 4.1 Shared helpers

```typescript
/**
 * Template-asset validation (10 §4). Proves (a) the {{TOKEN}} vocabulary in
 * references/templates/** matches 00 §4.1 / SKILL.md exactly (no orphan/undefined
 * tokens), and (b) the hand-authored references/docs.manifest.schema.json (00 §2.4) is
 * a valid JSON Schema that accepts the 00 §2.1 shape and rejects each 00 §2.2
 * violation. No emitted Astro build is involved — these are static-asset checks.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, it, expect } from "vitest";

import { REPO_ROOT } from "./golden.shared.js";

/** Canonical skill asset roots (01 §1). */
const SKILL_DIR = path.join(REPO_ROOT, "skills/doc-site-plugin");
const TEMPLATES_DIR = path.join(SKILL_DIR, "references/templates");
const SCHEMA_PATH = path.join(SKILL_DIR, "references/docs.manifest.schema.json");
const SKILL_MD = path.join(SKILL_DIR, "SKILL.md");
const FIXTURES_DIR = path.join(REPO_ROOT, "src/test/__fixtures__/doc-site");

/** Every {{TOKEN}} occurrence in a string, as a Set of token names (no braces). */
function tokensIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)) out.add(m[1]!);
  return out;
}

/** Recursively list every file under `dir`. */
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? walk(abs) : [abs];
  });
}

/**
 * The canonical token vocabulary (00 §4.1). This array is the single in-test
 * mirror of that table; the SKILL.md substitution table is asserted to match it in
 * §4.2 (so 00, SKILL.md, and the templates are all kept in agreement).
 */
const CANONICAL_TOKENS = [
  "SITE_TITLE", "SITE_DESC", "SITE_URL", "BASE_PATH", "REPO_SLUG", "GITHUB_URL",
  "PKG_MANAGER", "RUNTIME", "DOCS_PKG_DIR", "ACCENT_LIGHT", "ACCENT_DARK",
  "DEFAULT_BRANCH", "ASTRO_VERSION", "STARLIGHT_VERSION",
] as const;
```

### 4.2 Token-coverage test (token vocabulary, `00 §4`)

Proves the closed-vocabulary rule of `00 §4`: every `{{TOKEN}}` in
`references/templates/**` is in the canonical table **and** documented in SKILL.md, and
vice-versa — no undefined token (used but undocumented) and no orphan token
(documented but unused).

```typescript
describe("token vocabulary is closed and consistent (00 §4)", () => {
  /** Union of every token actually used across all template assets. */
  const usedTokens = new Set<string>();
  for (const file of walk(TEMPLATES_DIR)) {
    // favicon.svg and other token-free verbatim assets simply contribute nothing.
    for (const t of tokensIn(fs.readFileSync(file, "utf8"))) usedTokens.add(t);
  }
  const canonical = new Set<string>(CANONICAL_TOKENS);
  const skillTokens = tokensIn(fs.readFileSync(SKILL_MD, "utf8"));

  it("every token used in a template is in the 00 §4.1 canonical table (no undefined tokens)", () => {
    const undefinedTokens = [...usedTokens].filter((t) => !canonical.has(t)).sort();
    expect(undefinedTokens, `undefined tokens used in templates`).toEqual([]);
  });

  it("every canonical token is exercised by at least one template (no orphan tokens)", () => {
    const orphans = [...canonical].filter((t) => !usedTokens.has(t)).sort();
    expect(orphans, `documented-but-unused tokens`).toEqual([]);
  });

  it("the SKILL.md substitution table mirrors the canonical table exactly (01 §4)", () => {
    // SKILL.md carries the agent-facing mirror of 00 §4.1 (01 §4); it must list
    // every canonical token and no extras, so the agent and the spec never diverge.
    for (const t of canonical) {
      expect(skillTokens.has(t), `SKILL.md missing token {{${t}}}`).toBe(true);
    }
    const extra = [...skillTokens].filter((t) => !canonical.has(t)).sort();
    expect(extra, `SKILL.md documents tokens not in 00 §4.1`).toEqual([]);
  });
});
```

> The orphan check (no documented-but-unused token) is what makes
> `00 §4.1`'s closing sentence ("Components add no new tokens beyond this table
> without also adding a row here and in SKILL.md") enforceable: adding a token to
> the table without using it in a template fails the orphan assertion.

### 4.3 Schema-fixture validation (REQ-CONTENT-01/03/04, OQ-2)

Proves the hand-authored static `docs.manifest.schema.json` (`00 §2.4`) is (a) a
valid JSON Schema and (b) discriminating — it **accepts** every valid manifest
fixture and **rejects** each `00 §2.2` violation. Validation uses `ajv` with the
Draft 2020-12 metaschema. `ajv` is a **devDependency** added for this test only
(no runtime dependency added to `agent-docs` — tech-spec §9; it is test-only,
exactly as `@rgrove/parse-xml` is test-only for diagrams).

Fixtures live under `src/test/__fixtures__/doc-site/manifests/`:

| Fixture file                          | Shape (per `00 §2`)                                          | Expected |
| ------------------------------------- | ----------------------------------------------------------- | -------- |
| `valid-minimal.json`                  | `site` + `pages:[]` (empty pages allowed, `00 §2.2`)         | accept   |
| `valid-mixed.json`                    | one `source:symlink`+`from`, one `source:native`            | accept   |
| `valid-unmanaged.json`                | a page with `unmanaged:true`, no `source`/`from` (`00 §2.3`) | accept   |
| `invalid-symlink-missing-from.json`   | `source:symlink` with no `from` (rule 1, `00 §2.2`)         | reject   |
| `invalid-native-with-from.json`       | `source:native` carrying `from` (rule 2)                    | reject   |
| `invalid-missing-source.json`         | managed page (no `unmanaged`) with no `source` (rule 4)      | reject   |
| `invalid-duplicate-slug.json`         | two pages with the same `slug` (rule 5)                      | reject   |
| `invalid-unknown-key.json`            | a top-level or page-level extra key (rule 6, strict)        | reject   |

```typescript
import Ajv2020 from "ajv/dist/2020.js";

describe("docs.manifest.schema.json validates manifests (00 §2.4)", () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));

  it("is itself a valid JSON Schema (compiles)", () => {
    expect(() => ajv.compile(schema)).not.toThrow();
  });

  const validate = ajv.compile(schema);
  const readFixture = (name: string) =>
    JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "manifests", name), "utf8"));

  const cases: Array<{ file: string; valid: boolean }> = [
    { file: "valid-minimal.json", valid: true },
    { file: "valid-mixed.json", valid: true },
    { file: "valid-unmanaged.json", valid: true },
    { file: "invalid-symlink-missing-from.json", valid: false },
    { file: "invalid-native-with-from.json", valid: false },
    { file: "invalid-missing-source.json", valid: false },
    { file: "invalid-duplicate-slug.json", valid: false },
    { file: "invalid-unknown-key.json", valid: false },
  ];

  for (const { file, valid } of cases) {
    it(`${valid ? "accepts" : "rejects"} ${file}`, () => {
      const ok = validate(readFixture(file));
      expect(ok, JSON.stringify(validate.errors)).toBe(valid);
    });
  }
});
```

> **Duplicate-slug note.** JSON Schema cannot express "array items have a unique
> `slug` property" via `additionalProperties`; it requires `uniqueItems` over a
> projection, which Draft 2020-12 cannot do directly. The schema therefore enforces
> slug-uniqueness only insofar as JSON Schema allows; if the static schema cannot
> express rule 5, this case asserts the **documented behavior** instead and the
> uniqueness check is the symlinker/drift-guard's responsibility
> (`04-content-symlink-layer.md`, `07-drift-guard.md`). The spec author MUST,
> when writing the schema, either encode uniqueness if feasible or move
> `invalid-duplicate-slug.json` to an `it.skip` with a comment pointing at the
> guard that owns it. **WARNING: confirm whether `docs.manifest.schema.json` can
> express slug-uniqueness before relying on this case.**

## 5. Scaffold-output golden fixtures — `doc-site-scaffold.test.ts` (NEW)

This is the in-repo proof of REQ-PORT-02's *scaffolded-output* half (tech-spec §8
item 3): the `{{TOKEN}}` substitution **procedure** is deterministic and
agent-agnostic. It applies fixed interview-answer sets to the **real** template
assets via a single pure substitution function and asserts the result is
byte-identical to a checked-in resolved output tree — no live agent, no Astro
build, no network.

### 5.1 Interview-answer fixtures (`src/test/__fixtures__/doc-site/answers/`)

Each answer set is a JSON object pairing a **token map** (the resolved `00 §4.1`
values) with a **component-selection record** (`00 §5`), so the fixture fully
determines both *which* template groups are emitted and *how* tokens resolve.

```typescript
/**
 * One interview-answer fixture: the resolved token map (00 §4.1) plus the
 * component-selection record (00 §5). Together these are the complete input to the
 * deterministic substitution procedure — a pure function of these answers (REQ-PORT-02).
 */
export interface ScaffoldAnswers {
  /** Resolved value for every {{TOKEN}} in 00 §4.1 (keys are token names, no braces). */
  readonly tokens: Record<string, string>;
  /** Component-selection record (00 §5) deciding which template groups emit. */
  readonly selection: {
    readonly contentMode: "symlink" | "native" | "mixed";
    readonly diagrams: boolean;
    readonly deploy: ReadonlyArray<"github-pages" | "vercel" | "static-netlify">;
    readonly driftGuard: boolean;
    readonly monorepo: boolean;
  };
}
```

Three committed answer sets cover the load-bearing combinations:

| Answer set            | `contentMode` | selection summary                                              | Proves |
| --------------------- | ------------- | ------------------------------------------------------------- | ------ |
| `single-symlink.json` | `symlink`     | single-package, `deploy:["github-pages"]`, drift-guard on, diagrams off | symlinker + core + GH-pages deploy + monorepo OFF |
| `monorepo-mixed.json` | `mixed`       | `monorepo:true`, `deploy:["vercel"]`, diagrams **on**, drift-guard on | monorepo fragments + mixed mode + vercel + diagrams prebuild |
| `decline-all.json`    | `native`      | `diagrams:false, deploy:[], driftGuard:false, monorepo:false` | the REQ-USE-01 decline-all invariant (§5.4) |

### 5.2 The substitution procedure under test

The test exercises a single pure helper that mirrors the agent's mechanical step
(`01 §2.1`): for each **selected** template group (`01 §2.2`), read each `.tmpl`,
replace every `{{TOKEN}}` globally with its answer value, and write the result
under the resolved target path; verbatim assets (`favicon.svg`) are copied
unchanged. The helper is defined in the test (there is no production module — this
*is* the verification surface):

```typescript
/**
 * Scaffold-output goldens (10 §5). Applies a fixed interview-answer set to the REAL
 * references/templates/** via the same mechanical {{TOKEN}} substitution the agent
 * performs (01 §2.1), and asserts the resolved tree is byte-identical to the
 * checked-in __scaffold_golden__/<answer-set>/ tree. Proves the substitution
 * procedure is deterministic / agent-agnostic without a live agent (REQ-PORT-02),
 * and that declining every component emits ONLY the core scaffold (REQ-USE-01, §5.4).
 *
 * NO Astro build runs here — that is the target-repo smoke test (REQ-VERIFY-01),
 * owned by 08-rerun-and-verification.md. See 10 §2.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, it, expect } from "vitest";

import { REPO_ROOT } from "./golden.shared.js";

const TEMPLATES_DIR = path.join(REPO_ROOT, "skills/doc-site-plugin/references/templates");
const SCAFFOLD_GOLDEN_DIR = path.join(REPO_ROOT, "src/test/__scaffold_golden__");
const ANSWERS_DIR = path.join(REPO_ROOT, "src/test/__fixtures__/doc-site/answers");

/** Template groups (01 §2.2) and the predicate deciding whether each is emitted. */
const GROUPS: Array<{ dir: string; emit: (s: ScaffoldAnswers["selection"]) => boolean }> = [
  { dir: "core", emit: () => true }, // always (01 §2.2)
  { dir: "symlink", emit: (s) => s.contentMode === "symlink" || s.contentMode === "mixed" },
  { dir: "diagrams", emit: (s) => s.diagrams },
  { dir: "deploy/github-pages", emit: (s) => s.deploy.includes("github-pages") },
  { dir: "deploy/vercel", emit: (s) => s.deploy.includes("vercel") },
  { dir: "deploy/static", emit: (s) => s.deploy.includes("static-netlify") },
  { dir: "drift-guard", emit: (s) => s.driftGuard },
  { dir: "monorepo", emit: (s) => s.monorepo },
];

/** Plain global {{TOKEN}} replacement (00 §4: literal, no conditionals/loops). */
function substitute(body: string, tokens: Record<string, string>): string {
  return body.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_m, name: string) => {
    if (!(name in tokens)) throw new Error(`no answer for {{${name}}}`);
    return tokens[name]!;
  });
}

/** Resolve a whole answer set to a map of relpath → resolved bytes. */
function resolveTree(answers: ScaffoldAnswers): Map<string, string> {
  const out = new Map<string, string>();
  for (const group of GROUPS) {
    if (!group.emit(answers.selection)) continue; // declined → contributes nothing (00 §5)
    const groupAbs = path.join(TEMPLATES_DIR, group.dir);
    if (!fs.existsSync(groupAbs)) continue;
    for (const abs of walk(groupAbs)) {
      const rel = path.relative(TEMPLATES_DIR, abs).split(path.sep).join("/");
      const raw = fs.readFileSync(abs, "utf8");
      // `.tmpl` files get substitution + the extension stripped; others ride verbatim.
      const resolved = abs.endsWith(".tmpl") ? substitute(raw, answers.tokens) : raw;
      out.set(rel.replace(/\.tmpl$/, ""), resolved);
    }
  }
  return out;
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? walk(abs) : [abs];
  });
}

function readGoldenTree(name: string): Map<string, string> {
  const base = path.join(SCAFFOLD_GOLDEN_DIR, name);
  const out = new Map<string, string>();
  for (const abs of walk(base)) {
    out.set(path.relative(base, abs).split(path.sep).join("/"), fs.readFileSync(abs, "utf8"));
  }
  return out;
}

function loadAnswers(file: string): ScaffoldAnswers {
  return JSON.parse(fs.readFileSync(path.join(ANSWERS_DIR, file), "utf8")) as ScaffoldAnswers;
}
```

### 5.3 Golden comparison test + deliberate regeneration

```typescript
const ANSWER_SETS = ["single-symlink", "monorepo-mixed", "decline-all"] as const;

describe("scaffold-output goldens are deterministic (REQ-PORT-02 scaffolded output)", () => {
  for (const name of ANSWER_SETS) {
    it(`${name}: resolved tree is byte-identical to its committed golden`, () => {
      const resolved = resolveTree(loadAnswers(`${name}.json`));
      const golden = readGoldenTree(name);

      // Byte-exact per file.
      for (const [rel, content] of golden) {
        expect(resolved.get(rel), `missing/changed: ${name}/${rel}`).toBe(content);
      }
      // Bidirectional set equality: a newly emitted file with no golden (or a
      // removed golden) MUST fail — this is what catches a leaked declined-group file.
      expect([...resolved.keys()].sort()).toEqual([...golden.keys()].sort());
    });

    it(`${name}: substitution is idempotent / order-independent (deterministic)`, () => {
      const a = resolveTree(loadAnswers(`${name}.json`));
      const b = resolveTree(loadAnswers(`${name}.json`));
      expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
    });
  }
});
```

Goldens under `src/test/__scaffold_golden__/` are **never** auto-overwritten on a
plain `vitest run` — the same discipline as the emitter golden suite
(`golden.test.ts:15`). They are rewritten only by the deliberate
`src/test/regenerate-scaffold-goldens.ts` writer (mirroring
`src/test/regenerate-goldens.ts`), which calls the same `resolveTree` over the same
answer sets and writes the result, after which the author reviews the diff:

```typescript
/**
 * Scaffold-golden regeneration (10 §5.3) — DELIBERATE, reviewed step. Mirrors
 * src/test/regenerate-goldens.ts. Resolves every answer set in 10 §5.1 via the SAME
 * resolveTree the test uses and rewrites src/test/__scaffold_golden__/<set>/.
 * Goldens are NEVER auto-overwritten on `vitest run`; an unintended template or
 * token change surfaces as a failing doc-site-scaffold.test.ts assertion. Run:
 *
 *     bun run src/test/regenerate-scaffold-goldens.ts
 */
```

### 5.4 The decline-all invariant (REQ-USE-01, `00 §5`)

The `decline-all` answer set encodes `00 §5`'s decline-all invariant:
`contentMode:"native"`, `diagrams:false`, `deploy:[]`, `driftGuard:false`,
`monorepo:false`. Under that selection `resolveTree` emits **only** the `core/`
group (every other group's `emit` predicate is false), so the
`__scaffold_golden__/decline-all/` tree MUST contain **exactly** the resolved core
scaffold files (`01 §2.2` core row) and nothing else. The bidirectional set
equality in §5.3 makes the "zero files for declined components" claim an assertion,
not a comment: if any declined group leaked a file (a dangling hook, config, or
reference), the resolved key set would not equal the golden key set and the test
fails. An explicit guard makes the intent unmissable:

```typescript
describe("decline-all invariant — zero files for declined components (REQ-USE-01, 00 §5)", () => {
  it("emits ONLY core-group files when every optional component is declined", () => {
    const resolved = resolveTree(loadAnswers("decline-all.json"));
    // Every resolved relpath must originate from the core/ template group.
    const nonCore = [...resolved.keys()].filter((rel) => !rel.startsWith("core/")).sort();
    expect(nonCore, `declined-component files leaked into a minimal site`).toEqual([]);
    // And no diagram / deploy / drift / symlink / monorepo artifacts by name.
    for (const rel of resolved.keys()) {
      expect(rel).not.toMatch(/setup-docs|prebuild|docs\.yml|vercel|netlify|check-docs|workspace/);
    }
  });
});
```

## 6. Coverage targets

The bar is **behavioral**, not a global line-coverage percentage (matching
`specs/diagram-generator/08-testing-strategy.md §9`):

| Area                                  | Strategy                                          | Target                                                        |
| ------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| Skill emission (REQ-PORT-02 tool)     | `build --check` (exhaustive) + `SAMPLE_RELPATHS` goldens (§3) | every `.tmpl`/asset byte-identical across 5 targets; 1 transformed `SKILL.md` row/target |
| Token vocabulary (`00 §4`)            | token-coverage test (§4.2)                        | **every** documented token exercised by ≥1 template; **no** undefined or orphan token |
| Manifest schema (`00 §2`)             | accept/reject fixtures (§4.3)                      | every `00 §2.2` validation rule has ≥1 accepting and ≥1 rejecting fixture |
| Substitution procedure (REQ-PORT-02)  | scaffold-output goldens (§5)                       | **every emitted template covered by ≥1 scaffold fixture** (each template group appears in ≥1 answer set) |
| Decline-all (REQ-USE-01)              | decline-all fixture + invariant guard (§5.4)      | minimal site = core files only; zero declined-component files |

Two explicit cross-coverage obligations bind the answer sets to the templates:

1. **Every emitted template covered by ≥1 scaffold fixture.** Across the three
   answer sets, every template group in `01 §2.2` is selected at least once
   (`core` always; `symlink` via single-symlink/monorepo-mixed; `diagrams`,
   `monorepo`, `vercel` via monorepo-mixed; `github-pages`, `drift-guard` via
   single-symlink). `static-netlify` is the one group not covered by these three;
   the author MUST add a fourth answer set (or extend `monorepo-mixed`'s `deploy`
   to include `"static-netlify"`) so the coverage claim holds. A meta-test asserts
   it:

```typescript
it("every template group (01 §2.2) is exercised by at least one answer set", () => {
  const selected = new Set<string>();
  for (const name of ANSWER_SETS) {
    const sel = loadAnswers(`${name}.json`).selection;
    for (const g of GROUPS) if (g.emit(sel)) selected.add(g.dir);
  }
  const allGroups = GROUPS.map((g) => g.dir);
  const uncovered = allGroups.filter((d) => !selected.has(d) && fs.existsSync(path.join(TEMPLATES_DIR, d))).sort();
  expect(uncovered, `template groups never exercised by an answer set`).toEqual([]);
});
```

2. **Every documented token exercised** — already asserted by the §4.2 orphan
   check (no documented-but-unused token).

## Dependencies

This is the always-last document; it depends on the contracts and layout the rest
of the suite defines:

- `00-core-definitions.md` — the `{{TOKEN}}` vocabulary (`§4.1`) the §4.2 token
  test mirrors; the `docs.manifest.json` field contract + validation rules (`§2.2`)
  the §4.3 fixtures exercise; the `unmanaged` escape hatch (`§2.3`); the
  component-selection model + decline-all invariant (`§5`) the §5.4 test asserts;
  the static-schema decision (`§2.4`).
- `01-architecture-layout.md` — the template-group ↔ component map (`§2.2`) the §5
  `GROUPS` table encodes; the asset paths (`§1`); the in-repo verification surface
  + "no new gate stage" rule (`§3`); the per-target `SKILL.md` relpaths (`§5.2`)
  added to `SAMPLE_RELPATHS` in §3.2.
- `09-integration-and-emission.md` — registers the `doc-site-plugin` `ToolEntry`
  and the `SAMPLE_RELPATHS` rows / regenerated `__golden__/` that §3 relies on;
  confirms `schema:check` stays hardwired to `Manifest` (so the docs.manifest
  schema is test-validated here, not by `schema:check`).
- `08-rerun-and-verification.md` — owns the **runtime** REQ-VERIFY-01 /
  REQ-VERIFY-02 / REQ-DIAG-03 smoke test (target-repo, scaffold-time). This
  document deliberately does **not** cover it (§2).

Existing repo infrastructure reused (no new module): `src/driftguard.ts`
(`driftCheck`), `src/test/golden.shared.ts` (`SAMPLE_RELPATHS`, `REPO_ROOT`),
`src/test/golden.test.ts`, the `build:check` / `test` scripts (`package.json`).
New **devDependency**: `ajv` (test-only, for §4.3) — no runtime dependency added to
`agent-docs` (tech-spec §9).

## Verification

- [ ] `vitest run` (the `package.json` `"test"` script, `package.json:25`) executes
      `doc-site-templates.test.ts` and `doc-site-scaffold.test.ts` with no new
      framework, under the existing `test` gate stage — **no new gate stage added**
      (`01 §3`, tech-spec §6).
- [ ] `bun run build:check` (`src/driftguard.ts`) re-emits in memory and finds the
      `doc-site-plugin` `references/**` byte-identical across all five
      `adapters/` (REQ-PORT-02, exhaustive — §3.1).
- [ ] `SAMPLE_RELPATHS` (`src/test/golden.shared.ts`) gains the five per-target
      `doc-site-plugin` `SKILL.md` rows (§3.2 table) and `golden.test.ts` asserts
      them byte-exact (bidirectional set equality, `golden.test.ts:76`).
- [ ] Token-coverage test (§4.2): every `{{TOKEN}}` in `references/templates/**` is in
      `00 §4.1` and SKILL.md (no undefined tokens); every canonical token is used
      by ≥1 template (no orphan tokens); SKILL.md's table mirrors `00 §4.1` exactly.
- [ ] Schema-fixture test (§4.3): `docs.manifest.schema.json` compiles as a valid
      Draft 2020-12 schema; it **accepts** all three `valid-*.json` fixtures and
      **rejects** all five `invalid-*.json` fixtures (one per `00 §2.2` rule).
- [ ] Scaffold-output goldens (§5): each of the three (≥three) answer sets resolves
      byte-identically to its `__scaffold_golden__/<set>/` tree, with bidirectional
      set equality; resolution is deterministic across two runs.
- [ ] `__scaffold_golden__/` is regenerated only by the deliberate
      `bun run src/test/regenerate-scaffold-goldens.ts`, never auto-overwritten by a
      plain `vitest run`.
- [ ] Decline-all invariant (§5.4): the `decline-all` resolved tree contains
      **only** `core/`-group files — zero files for every declined component
      (REQ-USE-01, `00 §5`).
- [ ] Template-group coverage meta-test (§6) passes: every template group in
      `01 §2.2` is exercised by ≥1 answer set (the author has added coverage for the
      `static-netlify`/`deploy/static` group).
- [ ] No Astro/Starlight build, no diagram render, and no network call occurs in
      any `agent-docs` test (the runtime smoke test is owned by
      `08-rerun-and-verification.md`, §2).
- [ ] `bun run gate` stays green after the additions (REQ-PORT-02).
