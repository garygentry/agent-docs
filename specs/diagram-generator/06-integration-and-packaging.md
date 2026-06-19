# 06 — Integration & Packaging

How the `diagram-generator` skill plugs into the existing `agent-docs` emitter and
build pipeline: the single `ToolEntry` registration in `tools.manifest.json`, the
diagram JSON-Schema drift wiring, the pre-bundled CLI build + drift guard, the
verbatim emission of the skill (with its committed `.mjs` bundle, mode preserved)
to all five targets, the golden-relpath registration that keeps CI green, and the
`doc-site-plugin` consumer relationship.

This document is the **assembly point**: it does not (re)define the render
pipeline, the schema, or the CLI contract — it wires already-specified pieces into
the repo's existing `gate` and emitter discipline. It builds on
`00-core-definitions.md` (types/constants) and `01-architecture-layout.md` (the
module tree, dependency table, and `package.json` script set) and references
`02-schema-and-validation.md` (the schema generator) and
`05-cli-and-invocation.md` (the frozen CLI contract).

## Requirement Coverage

| REQ / item   | Requirement                                                       | Section |
| ------------ | ----------------------------------------------------------------- | ------- |
| CON-01       | Authored as a canonical skill, registered in the manifest         | 2       |
| CON-02       | Shared dependency — frozen scriptable contract for consumers      | 6       |
| REQ-INV-04   | Versioned contract surface that consumers pin against             | 6       |
| REQ-PORT-02  | Agent-agnostic — verbatim emission to all 5 targets               | 5       |
| REQ-OUT-04   | Build determinism — committed bundle byte-stable, drift-guarded   | 3, 4    |
| REQ-REPRO-01 | Deterministic bundle build + drift guard owns bundle bytes        | 4       |
| OTQ-1        | Golden strategy for the bundle — RESOLVED (committed byte golden) | 4.3     |

## 2. Manifest registration (CON-01)

The skill becomes canonical by appending **exactly one** `ToolEntry` to the
`tools[]` array of `tools.manifest.json`. The `ToolEntry` Zod shape is verified at
`src/model.ts:37-48`:

> **External reference note.** The `REQ-TOOLS-*` and `REQ-DISC-*` IDs that appear in
> the verbatim `src/model.ts` excerpt below (e.g. `REQ-TOOLS-01..04` on the `type`
> field, `REQ-DISC-01` on `targets`) are the **host `agent-docs` emitter's own**
> requirement vocabulary — a different namespace from this feature's PRD. They are
> reproduced verbatim from the existing source comment and are **not**
> diagram-generator PRD requirements (mirroring the external-label precedent for
> REQ-DIAG-02 in `TRACEABILITY.md`). Do not edit the verbatim code comment.

```typescript
// src/model.ts:37-48 (verbatim shape — do NOT redefine; this is the existing schema)
export const ToolEntry = z.object({
  /** kebab-case identifier; MUST match the on-disk source basename. */
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  /** Tool kind (REQ-TOOLS-01..04). */
  type: ToolType,
  /** Repo-relative path to the canonical file or directory. */
  source: z.string(),
  /** Optional human description; falls back to the source's frontmatter. */
  description: z.string().optional(),
  /** Per-target overrides/exclusions (REQ-DISC-01). */
  targets: z.record(Target, TargetToolFlags).optional(),
});
```

### 2.1 The one entry to append

```jsonc
{
  "name": "diagram-generator",
  "type": "skill",
  "source": "skills/diagram-generator",
  "description": "Converts natural-language or an engine-neutral node/edge/container spec into portable tier-2 SVG and PNG diagrams.",
}
```

- `name` satisfies the `^[a-z0-9]+(-[a-z0-9]+)*$` regex (`src/model.ts:39`) and
  matches the on-disk source basename `skills/diagram-generator` (the comment at
  `src/model.ts:38` requires this).
- `type: "skill"` (a member of `ToolType`).
- `source` is the canonical skill directory (`01-architecture-layout.md` §1).
- `description` is supplied so the manifest does not fall back to SKILL.md
  frontmatter; it is the human-facing summary.
- `targets` is **omitted** — the skill emits to all five targets with no
  per-target override or exclusion (REQ-PORT-02).

### 2.2 The `config` block is UNCHANGED (corrected finding V-002)

`config` is a top-level field of the `Manifest` object, **not** part of a
`ToolEntry`. A `ToolEntry` has exactly the five fields above. Registering this
skill touches `tools[]` only — appending one element. The Manifest's
`config`/`EmitterConfig` block (`src/model.ts:57+`, e.g. `skillsDir`, `scriptsDir`,
`agentsDir`) is left **byte-for-byte unchanged**. Any edit to `config` is out of
scope and would be a defect.

> **Verification hook:** `bun run schema:check` already validates
> `tools.manifest.json` against `schemas/tools.manifest.schema.json`. After the
> append, `schema:check` and the manifest parse (`Manifest.parse`) MUST still pass.

## 3. Diagram JSON-Schema generation wiring

The diagram input JSON Schema (`schemas/diagram-input.schema.json`) is generated
from the Zod `DiagramSpec` (`00-core-definitions.md` §2) by the generator specified
in **`02-schema-and-validation.md` §4/§5** (`src/diagram/schema-gen.ts`). That
generator mirrors the existing `src/schema-gen.ts` pattern — a pure builder plus a
side-effectful CLI with a `--check` drift mode (`src/schema-gen.ts:58-81`). **This
document does not redefine the generator**; it specifies only the `package.json`
script wiring and the `gate` integration.

### 3.1 The two scripts (per `01-architecture-layout.md` §5)

```jsonc
{
  "scripts": {
    "schema:gen:diagram": "bun run src/diagram/schema-gen.ts",
    "schema:check:diagram": "bun run src/diagram/schema-gen.ts --check",
  },
}
```

- `schema:gen:diagram` writes/overwrites the committed
  `schemas/diagram-input.schema.json` (run after any `src/diagram/schema.ts`
  change, then commit the result).
- `schema:check:diagram` re-generates in memory and diffs against the committed
  file, exiting non-zero on drift — the exact `--check` structure of
  `src/schema-gen.ts:64-76`.

### 3.2 Wired into `gate`

`schema:check:diagram` is part of the extended `gate` chain (§4.4) so a stale
committed diagram schema fails CI, exactly as `schema:check` does for the manifest
schema today.

## 4. Pre-bundled CLI packaging + drift guard (resolves OTQ-1)

### 4.1 `build:diagram` — produce the committed bundle

Per `01-architecture-layout.md` §5:

```jsonc
"build:diagram": "bun build src/diagram/cli.ts --target=node --minify --outfile skills/diagram-generator/scripts/diagram-render.mjs"
```

This bundles `src/diagram/cli.ts` and all of its transitive imports —
`@viz-js/viz` (WASM inlined/base64), `@resvg/resvg-js`, the XML parser, and the
subset font asset (`src/diagram/assets/font.subset.ts`) — into the single
committed file `skills/diagram-generator/scripts/diagram-render.mjs` (tech-spec
§3.3, `01` §2.1). `schema-gen.ts` is deliberately **not** part of the bundle (it is
a standalone script, `01` §3), keeping `zod-to-json-schema` out of the shipped
`.mjs`.

The committed `.mjs` is the only shipped artifact. After any `src/diagram/` change,
run `bun run build:diagram` and commit the regenerated bundle.

### 4.2 `build:diagram:check` — the drift guard (`src/diagram/build-check.ts`)

```jsonc
"build:diagram:check": "bun run src/diagram/build-check.ts"
```

Implementation approach for `src/diagram/build-check.ts`, mirroring the
`src/schema-gen.ts:58-81` `--check` structure (re-derive in memory, diff committed
bytes, exit non-zero on mismatch):

```typescript
#!/usr/bin/env bun
/**
 * build-check.ts — drift guard for the committed CLI bundle (REQ-OUT-04/REQ-REPRO-01).
 *
 * Re-bundles src/diagram/cli.ts in memory with the SAME flags as `build:diagram`,
 * compares the bytes to the committed skills/diagram-generator/scripts/diagram-render.mjs,
 * and exits non-zero on drift. Mirrors src/schema-gen.ts --check (src/schema-gen.ts:64-76).
 *
 * Usage:  bun run src/diagram/build-check.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/** Committed bundle path (repo-relative); single committed copy. */
export const BUNDLE_OUTPUT_PATH = "skills/diagram-generator/scripts/diagram-render.mjs" as const;

/** Bundle entry; MUST match the `build:diagram` script (01 §5). */
const ENTRY = "src/diagram/cli.ts";

/**
 * Re-bundle the CLI in memory with the exact `build:diagram` flags
 * (--target=node --minify) and return the artifact text. Pure w.r.t. the
 * filesystem output — writes nothing; the committed file is the reference.
 */
async function buildBundleText(repoRoot: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [resolve(repoRoot, ENTRY)],
    target: "node",
    minify: true,
  });
  if (!result.success) {
    console.error("build:diagram:check — in-memory bundle failed:");
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
  // Single-entry build → single artifact.
  return await result.outputs[0].text();
}

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dirname, "../..");
  const abs = resolve(repoRoot, BUNDLE_OUTPUT_PATH);
  const fresh = await buildBundleText(repoRoot);
  const committed = existsSync(abs) ? readFileSync(abs, "utf-8") : "";
  if (committed !== fresh) {
    console.error(
      `Bundle drift: ${BUNDLE_OUTPUT_PATH} differs from a fresh build of ${ENTRY}.\n` +
        `Run: bun run build:diagram   (then commit the result)`,
    );
    process.exit(1);
  }
  console.log("Diagram CLI bundle is in sync with src/diagram/.");
  process.exit(0);
}
```

> **Flag parity is load-bearing.** `build-check.ts` MUST use the _same_ bundler
> flags as `build:diagram` (`--target=node --minify`). If `build:diagram` gains a
> flag, this file must mirror it, or the drift guard produces false positives. To
> avoid skew, both the script string (`01` §5) and `ENTRY`/flags here are the
> single contract — keep them identical.
>
> The byte comparison reads the committed file as UTF-8 and compares string
> equality, matching `src/schema-gen.ts:66-67`. The `bun build` output is written
> to memory (via `Bun.build(...).outputs[0].text()`) — **never** to a temp file on
> disk — so the guard has no filesystem side effects.

### 4.3 OTQ-1 RESOLVED — commit a byte golden for the bundle

**Decision:** the emission goldens (`src/test/__golden__/`, `08`) include a
**committed byte golden** for `diagram-render.mjs` in each target tree, exactly like
every other emitted file. This is the only mechanism that satisfies the real
`golden.test.ts` three-way set equality (see below); the earlier "presence-only / no
byte compare" framing was incompatible with the actual test and is dropped.

**Why this is the correct (and only passing) option:** `golden.test.ts` enforces a
strict three-way equality `emitted == golden == wanted` over the sample-scoped
relpaths. Concretely, with `wanted = SAMPLE_RELPATHS[target]`:

- line 64 keeps only emitted files whose relpath is in `wanted`;
- lines 70-71 byte-compare **every committed golden** against the emitted content;
- line 76 asserts `emitted.keys() === golden.keys()`;
- line 78 asserts `golden.keys() === wanted`.

So registering the `.mjs` relpath in `SAMPLE_RELPATHS` (§5.3) **without** committing
a `.mjs` golden makes line 78 fail (golden omits it, wanted has it) and line 76 fail
(emitted has it, golden omits it). The only way for the relpath to live in `wanted`
is to commit its golden — which is byte-compared at lines 70-71. There is no
"presence without bytes" path through this test.

**Accepted trade-off (dependency-bump churn):** committing the `.mjs` golden means a
dependency bump or toolchain change that alters the bundle bytes produces a golden
diff that must be regenerated (`bun run src/test/regenerate-goldens.ts`, `08 §6.3`).
This is acceptable and already the norm for the repo: `build:diagram:check` (§4.2)
pins the same bytes via the drift guard, so the bundle bytes are committed-and-checked
in two places that move together. When the bundle legitimately changes, both the
committed `.mjs` and its golden are regenerated in the same commit.

> Mechanically: the `.mjs` relpath appears in `SAMPLE_RELPATHS[target]` (so
> `golden.test.ts:78` requires it and `:76` requires the emitter to produce exactly
> that set), and `readGolden(target)` returns a committed golden for it, so
> `golden.test.ts:70-71` byte-compares the emitted bundle against that golden — the
> standard path every emitted file takes. Byte-fidelity is thus enforced in both the
> golden suite and `build:diagram:check` (§4.2).

### 4.4 Both checks wired into `gate` (from `01-architecture-layout.md` §5)

The extended `gate` script (verbatim from `01` §5):

```jsonc
"gate": "bun run compile && bun run schema:check && bun run schema:check:diagram && bun run typecheck && bun run lint && bun run format:check && bun run test && bun run build:check && bun run build:diagram:check"
```

`gate` gains exactly two diagram checks relative to the pre-existing chain:
`schema:check:diagram` (§3.2) and `build:diagram:check` (§4.2). A stale committed
schema OR a stale committed bundle now fails CI — the same discipline the manifest
schema (`schema:check`) and the adapter tree (`build:check`) already enforce.

## 5. Verbatim emission to all five targets (REQ-PORT-02)

This is the linchpin requirement: the same skill — including its executable bundle
— must reach every target identically, with the bundle still runnable.

### 5.1 Verbatim copy with mode preserved

Skill-owned `scripts/` and `references/` ship **verbatim** through the existing
emitter. The owned-subtree → per-target relpath mapping is performed by
`skillVerbatimRecords` (`src/targets/_shared.ts:226-237`), which rebases each owned
ref under the per-target skill location returned by `skillRefDir`
(`src/targets/_shared.ts:203-212`). The byte-for-byte copy itself is done by the
publish step at `src/publish.ts:113-120`, and it **preserves the executable mode**:

```typescript
// src/publish.ts:116-119 (verified) — verbatim copy preserves file mode
const sourceAbs = confinePath(roots.repoRoot, record.sourcePath);
const content = readFileSync(sourceAbs, "utf8");
const mode = statSync(sourceAbs).mode & 0o777; // ← mode carried through
writeConfined(staging, record.relpath, content, mode);
```

Because `statSync(...).mode & 0o777` is propagated into `writeConfined`, the
`diagram-render.mjs` bundle arrives in each target tree with the same permission
bits it carries in `skills/diagram-generator/scripts/`. No transform touches the
`.mjs` content (no provenance header — `src/publish.ts:114-115`), so the emitted
bundle is byte-identical to the committed one and runs with zero install
(`01-architecture-layout.md` §2.2).

### 5.2 Per-target relpath transforms (verified against `_shared.ts`)

`skillRefDir` (`src/targets/_shared.ts:203-212`) maps the skill location:

| Target  | Skill location prefix (`skillRefDir`) | SKILL file transform                             |
| ------- | ------------------------------------- | ------------------------------------------------ |
| claude  | `skills/diagram-generator`            | `SKILL.md` (unchanged)                           |
| codex   | `skills/diagram-generator`            | `SKILL.md` (unchanged)                           |
| gemini  | `skills/diagram-generator`            | `SKILL.md` → `diagram-generator.md`              |
| copilot | `instructions/diagram-generator`      | `instructions/diagram-generator.instructions.md` |
| cursor  | `rules/diagram-generator`             | `rules/diagram-generator.mdc`                    |

Owned refs (`references/*.md`, `scripts/diagram-render.mjs`) are rebased under the
`skillRefDir` prefix verbatim (`skillVerbatimRecords`,
`src/targets/_shared.ts:226-237`), so they land beside the (possibly renamed)
SKILL file. The skill's canonical owned files are:

- `SKILL.md`
- `references/schema-guide.md`
- `references/diagram-craft.md`
- `scripts/diagram-render.mjs`

Applying the verified `skillRefDir`/`skillVerbatimRecords` rules and the
per-target SKILL transform yields the **exact** emitted (`<target>/`-stripped)
relpath set per target:

**claude** (and **codex** — identical paths):

```
skills/diagram-generator/SKILL.md
skills/diagram-generator/references/schema-guide.md
skills/diagram-generator/references/diagram-craft.md
skills/diagram-generator/scripts/diagram-render.mjs
```

**gemini** (SKILL renamed; refs/scripts under `skills/diagram-generator/`; PLUS the
aggregate `gemini-extension.json`):

```
skills/diagram-generator/diagram-generator.md
skills/diagram-generator/references/schema-guide.md
skills/diagram-generator/references/diagram-craft.md
skills/diagram-generator/scripts/diagram-render.mjs
gemini-extension.json
```

**copilot** (`instructions/` prefix):

```
instructions/diagram-generator.instructions.md
instructions/diagram-generator/references/schema-guide.md
instructions/diagram-generator/references/diagram-craft.md
instructions/diagram-generator/scripts/diagram-render.mjs
```

**cursor** (`rules/` prefix; flattened `.mdc` with sibling owned dir):

```
rules/diagram-generator.mdc
rules/diagram-generator/references/schema-guide.md
rules/diagram-generator/references/diagram-craft.md
rules/diagram-generator/scripts/diagram-render.mjs
```

> **Verified** against `src/targets/_shared.ts:203-237` and the existing
> docs-helper golden tree (`src/test/__golden__/{claude,codex}/skills/docs-helper/SKILL.md`,
> `.../gemini/skills/docs-helper/docs-helper.md`, `.../copilot/instructions/docs-helper.instructions.md`,
> `.../cursor/rules/docs-helper.mdc`, `.../gemini/gemini-extension.json`). The
> docs-helper sample carries no owned `references/`/`scripts/`, so it shows only the
> SKILL transform; the owned-subtree rebasing above is derived from
> `skillVerbatimRecords` directly. The gemini aggregate `gemini-extension.json` is
> the only aggregate this skill contributes (a skill has no `agents/` entry, so
> codex emits no `agents/openai.yaml`), consistent with the
> `SAMPLE_RELPATHS` note at `src/test/golden.shared.ts:31-32`.

### 5.3 `SAMPLE_RELPATHS` registration (`src/test/golden.shared.ts`)

`golden.test.ts` enforces **three-way set equality** (verified at
`golden.test.ts:76-78`): emitted sample-scoped keys, golden keys, and the
`wanted`/`SAMPLE_RELPATHS` set must all be equal — so a missing OR extra relpath
fails CI. The diagram-generator relpaths from §5.2 MUST be added to the
per-target arrays in `SAMPLE_RELPATHS` (`src/test/golden.shared.ts:34-40`),
alongside the existing docs-helper entries:

```typescript
// src/test/golden.shared.ts — extend each target with diagram-generator relpaths
export const SAMPLE_RELPATHS: Record<Target, string[]> = {
  claude: [
    "skills/docs-helper/SKILL.md",
    "skills/diagram-generator/SKILL.md",
    "skills/diagram-generator/references/schema-guide.md",
    "skills/diagram-generator/references/diagram-craft.md",
    "skills/diagram-generator/scripts/diagram-render.mjs",
  ],
  codex: [
    "skills/docs-helper/SKILL.md",
    "skills/diagram-generator/SKILL.md",
    "skills/diagram-generator/references/schema-guide.md",
    "skills/diagram-generator/references/diagram-craft.md",
    "skills/diagram-generator/scripts/diagram-render.mjs",
  ],
  copilot: [
    "instructions/docs-helper.instructions.md",
    "instructions/diagram-generator.instructions.md",
    "instructions/diagram-generator/references/schema-guide.md",
    "instructions/diagram-generator/references/diagram-craft.md",
    "instructions/diagram-generator/scripts/diagram-render.mjs",
  ],
  cursor: [
    "rules/docs-helper.mdc",
    "rules/diagram-generator.mdc",
    "rules/diagram-generator/references/schema-guide.md",
    "rules/diagram-generator/references/diagram-craft.md",
    "rules/diagram-generator/scripts/diagram-render.mjs",
  ],
  gemini: [
    "skills/docs-helper/docs-helper.md",
    "gemini-extension.json",
    "skills/diagram-generator/diagram-generator.md",
    "skills/diagram-generator/references/schema-guide.md",
    "skills/diagram-generator/references/diagram-craft.md",
    "skills/diagram-generator/scripts/diagram-render.mjs",
  ],
};
```

> The existing `gemini-extension.json` golden is regenerated by the sample build
> when `diagram-generator` is added to the sample manifest; its golden content
> updates accordingly (it does NOT contain bundle bytes, only the aggregate
> manifest). Every relpath added to `SAMPLE_RELPATHS` — including the `.mjs`, the
> `references/*.md`, and the SKILL file — MUST have a committed byte golden, because
> `golden.test.ts`'s three-way set equality (`:76`/`:78`) requires `golden.keys()`
> to equal `wanted` exactly (§4.3, OTQ-1). The `.mjs` golden is byte-compared like
> any other file (`:70-71`); regenerate it together with the committed bundle
> whenever `src/diagram/` changes.

### 5.4 If a transform differs

If, during implementation, the emitted set diverges from §5.2 (e.g. an unexpected
`skillRefDir` case or a SKILL-rename rule), the implementer MUST correct the
`SAMPLE_RELPATHS` entries to match the **actual** emitter output and re-verify
against the three-way set equality at `golden.test.ts:76-78`. The set equality is
the source of truth — a guessed relpath that the emitter does not produce will fail
`:76`, and an emitted relpath missing from `SAMPLE_RELPATHS` will fail `:78`.

## 6. `doc-site-plugin` consumer relationship (CON-02, REQ-INV-04)

`diagram-generator` is a **shared dependency**: `doc-site-plugin`'s prebuild invokes
the bundled `diagram-render` CLI to materialize diagrams (CON-02). The contract
surface it depends on is the **frozen, versioned** CLI interface specified in
`05-cli-and-invocation.md` §1–§3 — input (`DiagramSpec` JSON via file or `-`),
output-path precedence, the six `--type` values, formats, exit codes, and
`--version` printing `CONTRACT_VERSION` (`00-core-definitions.md` §6).

- **Ship-first ordering.** `diagram-generator` ships **before** `doc-site-plugin`'s
  diagram component is implemented, so the contract is stable before any consumer
  binds to it. This resolves `doc-site-plugin`'s **OQ-4** (the open question of what
  the diagram CLI's interface is): the answer is the §5 contract in
  `05-cli-and-invocation.md`, frozen and versioned here.
- **Pinning.** Because the contract is versioned via `CONTRACT_VERSION`
  (`00` §6, REQ-INV-04), `doc-site-plugin` can pin against a known release; any
  breaking change to flags, IO, output names, or exit semantics requires a
  `CONTRACT_VERSION` MAJOR bump (`00` §6 doc comment).
- **Zero install.** The consumer runs the committed bundle directly
  (`bun .../skills/diagram-generator/scripts/diagram-render.mjs …`) with no
  `node_modules` (`01-architecture-layout.md` §2.2) — the verbatim, mode-preserved
  emission (§5.1) guarantees the same runnable bundle in whichever target tree the
  consumer vendors.

## Dependencies

Implement these first:

- `00-core-definitions.md` — `CONTRACT_VERSION`, `EXIT_CODES`, the `DiagramSpec`
  shape referenced by the registered schema and the consumer contract.
- `01-architecture-layout.md` — the `src/diagram/` module tree, the dependency
  table, and the `package.json` script set (`build:diagram`, `build:diagram:check`,
  `schema:gen:diagram`, `schema:check:diagram`, extended `gate`) this document
  wires.
- `02-schema-and-validation.md` — the `src/diagram/schema-gen.ts` generator whose
  scripts §3 wires (this document does not define it).
- `05-cli-and-invocation.md` — the frozen CLI contract §6 references for the
  consumer.
- Existing emitter modules (unchanged, relied upon): `src/model.ts` (`ToolEntry`),
  `src/schema-gen.ts` (the `--check` pattern mirrored), `src/targets/_shared.ts`
  (`skillRefDir`/`skillVerbatimRecords`), `src/publish.ts` (mode-preserving copy),
  `src/test/golden.shared.ts` (`SAMPLE_RELPATHS`), `src/test/golden.test.ts`
  (set-equality enforcement).

## Verification

- [ ] `tools.manifest.json` has exactly one new `tools[]` element matching §2.1;
      the `config` block is byte-for-byte unchanged (§2.2).
- [ ] `bun run schema:check` passes (manifest still valid after the append).
- [ ] `bun run schema:check:diagram` is green and fails when
      `schemas/diagram-input.schema.json` is stale.
- [ ] `bun run build:diagram` writes
      `skills/diagram-generator/scripts/diagram-render.mjs`; `bun run build:diagram:check`
      is green and fails after any uncommitted `src/diagram/` change.
- [ ] `bun run build` emits the skill (SKILL.md + `references/` + `scripts/`) into
      all five `adapters/<target>/` trees, with the `.mjs` mode preserved
      (`statSync(...).mode & 0o777`, `src/publish.ts:116-119`).
- [ ] `SAMPLE_RELPATHS` (`src/test/golden.shared.ts`) is extended with the exact
      per-target relpath sets in §5.2/§5.3; `golden.test.ts` three-way set equality
      (`:76-78`) passes (no missing, no extra relpath).
- [ ] A committed byte golden exists for `diagram-render.mjs` in each target tree
      (OTQ-1, §4.3); it is byte-compared by `golden.test.ts:70-71` and regenerated
      together with the committed bundle whenever `src/diagram/` changes.
- [ ] `bun run gate` runs both new diagram checks and stays green (§4.4).
- [ ] New external packages are in `devDependencies`, not `dependencies`
      (`01-architecture-layout.md` §4).
