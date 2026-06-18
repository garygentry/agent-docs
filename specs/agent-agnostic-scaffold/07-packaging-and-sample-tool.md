# 07 — Packaging, Reuse & the MVP Sample Skill

This document specifies three things that together make the scaffold _shippable_ and
_provable_:

1. **Packaging** — `src/plugin.ts`, which emits the `.claude-plugin/` manifests
   (`plugin.json` + `marketplace.json`) so the canonical Claude side is an installable
   Claude plugin (REQ-PKG-01, resolves PRD **OQ-05**).
2. **Reuse** — how the in-repo emitter is reused, unchanged, in another repository
   purely via configuration (REQ-REUSE-01), with a concrete walkthrough and an explicit
   statement that there is **no** standalone published CLI this version (respects
   OOS-04).
3. **The MVP sample skill** — the single real `docs-helper` skill that is the
   end-to-end proof (SC-02), its exact canonical files, and what "correct" emission
   means for **all five** targets (resolves PRD **OQ-04**, underpins SC-02/SC-08).

All shared types (`Manifest`, `EmitterConfig`, `ToolEntry`, `EmitResult`,
`EmittedFile`, `Target`), constants (`PROVENANCE`, `REGEN_CMD`, `TARGET_ORDER`), and
the error hierarchy (`EmitterError`, `SourceNotFoundError`) come from
`00-core-definitions.md` and are **referenced, not redefined** here. The byte-exact
golden files for the sample skill live under `src/test/__golden__/` and are **owned by
`08-testing-strategy.md`** — this document specifies _what_ the sample skill is and
_what correct emission means_ per target; `08` asserts the bytes.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-PKG-01 | Canonical Claude side packaged as installable plugin (plugin + marketplace manifest) | 3, 4 |
| REQ-REUSE-01 | Canonical format + emitter reusable in other repos | 5 |
| REQ-EMIT-06 / REQ-REL-01 | Plugin manifests byte-stable, deterministic | 3.4 |
| REQ-VALID-01 (ref) | Plugin manifests are generated, committed, drift-guarded | 3.5 |
| REQ-TOOLS-01 | Sample tool is a skill (SKILL.md + reference) | 6 |
| REQ-EMIT-07 | Sample skill emits correctly to all four targets + claude | 7 |
| REQ-EMIT-03 (ref) | Sample skill's per-target drops are recorded | 7 |
| PRD OQ-04 | Which sample tool; its correct per-target output | 6, 7 |
| PRD OQ-05 | Plugin/marketplace manifest specifics | 3 |

Resolved open questions: **OQ-04** (§6, §7) and **OQ-05** (§3).

## 1. Dependencies

This document depends on, and must be implemented after:

- `00-core-definitions.md` — `Manifest`, `EmitterConfig`, `EmitResult`,
  `EmittedFile`, `Target`, `PROVENANCE`, `REGEN_CMD`, `EmitterError`,
  `SourceNotFoundError`.
- `01-architecture-layout.md` — module placement (`src/plugin.ts`,
  `.claude-plugin/`), the `package.json` shape (§3 there provides `name`/`version`),
  and the barrel `src/index.ts`.
- `02-manifest-and-config.md` — the loaded `Manifest` (incl. `config` block) is the
  input to `emitPlugin`; the sample skill's `ToolEntry` lives here.
- `04-transforms.md` — the per-target transform rules; §7 below is a direct
  application of those rules to the sample skill. The `adapters/claude/` tree it
  produces is half of the plugin bundle (§3.1).
- `08-testing-strategy.md` — owns the byte-exact `__golden__/` files this document
  describes the _content intent_ of.

Must be implemented **after** `04` and `05` (the plugin bundle = the emitted
`adapters/claude/` tree + the manifests this module adds). The plugin emit is a final
step of a normal `bun run build`, invoked by the engine in
`05-overrides-publish-determinism.md`.

## 2. Reference shape (feature-forge — verified)

The manifest shapes below are grounded in feature-forge's committed manifests, read
from `/home/gary/workspace/feature-forge/.claude-plugin/` (both files **confirmed to
exist**):

`plugin.json` (verified fields): `name`, `version`, `description`, `author` (an
object `{ name }`), `keywords` (string array).

`marketplace.json` (verified fields): `name`, `description`, `owner` (object
`{ name }`), `plugins` — an array of `{ name, source, description, version }` where
`source` is `"."` (the plugin lives at the repo root). Note: feature-forge serializes
the `→` arrow as the escaped `→` in the marketplace `description`; we avoid that
by not embedding non-ASCII arrows in our generated descriptions (see §3.4).

No fields beyond these are invented. There is **no `WARNING`** for OQ-05 — both
reference manifests exist and were inspected.

## 3. Plugin packaging — `src/plugin.ts` (REQ-PKG-01, OQ-05)

### 3.1 What the bundle is

The installable Claude plugin bundle is the union of two already-existing pieces:

- the emitted **`adapters/claude/`** tree (skills/agents/commands in native Claude
  form, produced by `04-transforms.md` §6), and
- the **`.claude-plugin/`** directory (`plugin.json` + `marketplace.json`) produced by
  this module.

The canonical Claude side thus doubles as both the source of truth (CON-03) and the
plugin payload (tech-spec §3.2/§3.8). `src/plugin.ts` does **not** re-derive any tool
content; it only emits the two manifest files. `source: "."` in the marketplace entry
points at the repo root, which is where `.claude-plugin/` and `adapters/claude/` live.

### 3.2 Inputs and the manifest field mapping

The plugin manifests draw their metadata from the project `package.json`
(`01-architecture-layout.md` §3 — `name`, `version`) plus a small, optional
`plugin` block on the loaded `Manifest.config`. To keep the emitter path-agnostic
(REQ-REUSE-01) and avoid a second source of truth for name/version, `emitPlugin`
accepts a resolved `PluginMeta` assembled by `cli.ts`/`emit.ts`, not raw file reads.

`PluginMeta` is the only new type this document introduces; it is small and local to
packaging, so it is defined here (not in `00`) and re-exported via the barrel.

```typescript
import type { Manifest } from "./model.js";

/**
 * Resolved metadata for the Claude plugin manifests. Assembled by the engine from
 * package.json + manifest config so `emitPlugin` performs no I/O of its own
 * (keeps it pure + path-agnostic; REQ-REUSE-01).
 */
export interface PluginMeta {
  /** Plugin name. Defaults from package.json `name`; kebab-case. */
  name: string;
  /** SemVer string. Defaults from package.json `version`. */
  version: string;
  /** Short, ASCII-only description (no `→`; see §3.4). */
  description: string;
  /** Author/owner display name (feature-forge uses `{ name }`). */
  author: string;
  /** Discovery keywords for plugin.json. May be empty. */
  keywords: string[];
  /** Optional longer marketplace blurb; falls back to `description`. */
  marketplaceDescription?: string;
}
```

`PluginMeta` SHOULD be sourced as follows (assembly happens in `emit.ts`, not in this
pure module):

| `PluginMeta` field | Source | Fallback |
|--------------------|--------|----------|
| `name` | `package.json.name` | required |
| `version` | `package.json.version` | required |
| `description` | optional `Manifest.config.plugin.description` | a fixed default string |
| `author` | optional `Manifest.config.plugin.author` | `package.json.author?.name` |
| `keywords` | optional `Manifest.config.plugin.keywords` | `[]` |
| `marketplaceDescription` | optional `Manifest.config.plugin.marketplaceDescription` | `description` |

> NOTE: the optional `Manifest.config.plugin` block is a forward extension of the
> `EmitterConfig` Zod schema in `00-core-definitions.md` §2.3. If `02-manifest-and-config.md`
> has not added it, `emit.ts` MUST fall back entirely to `package.json` + the fixed
> defaults above, and `emitPlugin` MUST still produce valid manifests. This document
> does NOT redefine `EmitterConfig`; it only states the fallback contract. (If the
> `plugin` block is absent from the schema at implementation time, treat every config
> field above as "fallback".)

### 3.3 The `emitPlugin` function

```typescript
import type { EmittedFile } from "./model.js";

/**
 * Produce the two `.claude-plugin/` manifest files for the canonical Claude side
 * (REQ-PKG-01). Pure: no filesystem access — returns EmittedFile[] for the engine
 * in `05-overrides-publish-determinism.md` to write atomically alongside the
 * adapter tree. Output is byte-stable (REQ-EMIT-06): fixed key order, no timestamps.
 *
 * @param meta Resolved plugin metadata (see PluginMeta / §3.2).
 * @returns Exactly two EmittedFile entries, relpaths relative to the repo root:
 *          `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`,
 *          both mode 0o644.
 * @throws {EmitterError} code `PLUGIN_META_INVALID` if `name` or `version` is empty,
 *          or `version` is not a non-empty SemVer-shaped string.
 */
export function emitPlugin(meta: PluginMeta): EmittedFile[];
```

#### `plugin.json` shape (mirrors feature-forge, §2)

```jsonc
{
  "name": "<meta.name>",
  "version": "<meta.version>",
  "description": "<meta.description>",
  "author": { "name": "<meta.author>" },
  "keywords": ["<...meta.keywords>"]
}
```

#### `marketplace.json` shape (mirrors feature-forge, §2)

```jsonc
{
  "name": "<meta.name>",
  "description": "<meta.marketplaceDescription ?? meta.description>",
  "owner": { "name": "<meta.author>" },
  "plugins": [
    {
      "name": "<meta.name>",
      "source": ".",
      "description": "<meta.description>",
      "version": "<meta.version>"
    }
  ]
}
```

### 3.4 Determinism & serialization (REQ-EMIT-06, REQ-REL-01)

- Serialize via `JSON.stringify(obj, null, 2)` followed by a trailing newline — a
  fixed 2-space indent and a deterministic key order driven by **literal object
  construction order** (the orders shown in §3.3), never by iterating a `Map` or
  `Object.keys` of dynamic input.
- **No timestamps, no environment-derived values** — the only inputs are `PluginMeta`
  fields. Same `PluginMeta` ⇒ byte-identical manifests on every run.
- **ASCII-only descriptions.** Do not embed `→` (U+2192) or other non-ASCII glyphs in
  generated descriptions; use ASCII `->` if an arrow is needed. This avoids the
  `→` escaping divergence observed in feature-forge's marketplace.json (§2) and
  keeps the bytes obvious for the drift guard.
- These JSON manifests are **strict JSON** and carry **no provenance header** — JSON
  has no comment syntax, and the feature-forge reference manifests carry none. The
  `PROVENANCE` Form C (`_generated` key, `00-core-definitions.md` §5) is used by the
  emitter for the gemini extension manifest, **not** here; plugin manifests follow the
  feature-forge shape exactly so an installer reads them unmodified. They remain
  drift-guarded by virtue of being committed generated files (§3.5).

### 3.5 Generated, committed, drift-guarded

The two manifests are written into `.claude-plugin/` by the publish step of a normal
`bun run build` (engine in `05-overrides-publish-determinism.md`), committed to the
repo (like `adapters/`, CON-02), and checked by the drift guard. Because `emitPlugin`
is deterministic (§3.4), `bun run build --check` re-emits them into the staging tree
and diffs against the committed copies exactly as it does for adapter files
(`06-validation-and-drift-guard.md` §drift). A hand-edit to a committed
`.claude-plugin/*.json` therefore fails the drift guard (SC-04 posture extended to the
plugin manifests).

> Integration note: `.claude-plugin/` sits at the repo root, **outside** the
> `adapters/` subtree. The drift guard's path set MUST include `.claude-plugin/` in
> addition to `adaptersDir`. This is flagged for `06-validation-and-drift-guard.md`;
> if `06` scopes the guard to `adaptersDir` only, the plugin manifests would be
> unguarded — `06` MUST add `.claude-plugin/` to the guarded roots.

### 3.6 Error handling

| Condition | Behavior |
|-----------|----------|
| `meta.name` empty / not kebab-case | throw `EmitterError("...", "PLUGIN_META_INVALID")` |
| `meta.version` empty / not SemVer-shaped | throw `EmitterError("...", "PLUGIN_META_INVALID")` |
| `meta.author` empty | allowed; emit `{ "name": "" }`? **No** — throw `PLUGIN_META_INVALID`; an installable plugin needs an owner. |
| `package.json` missing `name`/`version` (assembly side, in `emit.ts`) | surface as `EmitterError` `PLUGIN_META_INVALID` before calling `emitPlugin` |

`emitPlugin` itself performs no filesystem reads, so it raises no
`SourceNotFoundError`/`PathEscapeError`; those belong to discovery/publish. Failures
are fatal (non-zero exit, no partial `adapters/` tree — atomic publish, tech-spec
§3.6).

### 3.7 Example

```typescript
const meta: PluginMeta = {
  name: "agent-docs",
  version: "0.1.0",
  description:
    "Agent-agnostic documentation tooling: author skills/agents/commands once in Claude-native form, emit adapters for Codex, Copilot, Cursor, and Gemini.",
  author: "Gary Gentry",
  keywords: ["documentation", "skills", "agents", "commands", "multi-agent"],
};

const files = emitPlugin(meta);
// files[0].relpath === ".claude-plugin/plugin.json"
// files[1].relpath === ".claude-plugin/marketplace.json"
```

## 4. Verification of packaging

- [ ] `bun run build` writes `.claude-plugin/plugin.json` and
      `.claude-plugin/marketplace.json` with exactly the fields in §3.3.
- [ ] Re-running `bun run build` with no input change produces zero diff in
      `.claude-plugin/` (byte-stable, SC-03).
- [ ] `bun run build --check` fails after hand-editing a committed
      `.claude-plugin/*.json` and passes after reverting (SC-04 extended; requires
      `06` to guard `.claude-plugin/`).
- [ ] `plugin.json` validates against feature-forge's shape (`name`, `version`,
      `description`, `author.name`, `keywords[]`); `marketplace.json` has a single
      `plugins[0]` with `source: "."` (SC-07).
- [ ] No non-ASCII glyphs appear in either manifest (grep for `→` / `→`).

## 5. Reuse in another repository (REQ-REUSE-01, OOS-04)

### 5.1 Posture: ship in-repo, design for reuse, do not extract

Per tech-spec §3.8 and OOS-04, there is **no standalone published CLI** this version.
The emitter ships inside `agent-docs` but is written to be **config-driven and
path-agnostic**: no module hardcodes a root path or the target list — all come from
the `EmitterConfig` block in `tools.manifest.json` (`00-core-definitions.md` §2.3,
verified in `01-architecture-layout.md` §verification). Reuse is achieved by copying
the `src/` emitter into another repo (or depending on it via the package `main`/`types`
barrel, `01` §5) and pointing its config at that repo's layout.

### 5.2 Two reuse modes

**A. Vendored emitter (copy `src/`).** Copy `src/` and `package.json`
deps/scripts into the target repo. The emitter is driven entirely by that repo's own
`tools.manifest.json`. Nothing in `src/` references `agent-docs` by name.

**B. Programmatic library (import the barrel).** Depend on the published `dist/`
(`01` §3 sets `main`/`types`) and call the three re-exported functions
(`01-architecture-layout.md` §5):

```typescript
import { loadManifest, emit, driftCheck } from "agent-docs-scaffold";

const manifest = loadManifest("./tools.manifest.json"); // throws ManifestValidationError on bad input
const result = emit(manifest, { repoRoot: process.cwd() });
// write result.files / inspect result.drops, or:
const drift = driftCheck(manifest, { repoRoot: process.cwd() }); // DriftEntry[]
```

`emitPlugin` (§3.3) is also re-exported via the barrel for repos that want the Claude
plugin manifests with their own `PluginMeta`.

### 5.3 Concrete walkthrough: adopting the scaffold in `other-repo`

A team wants the same agent-agnostic structure in a different repository whose
canonical sources live in non-default directories (e.g. `prompts/` instead of
`skills/`, and only three targets):

1. **Bring in the emitter.** Vendor `src/` (mode A) or add the package dep (mode B).
   Copy the `package.json` scripts (`build`, `build:check`, `schema:check`, `gate`)
   and dev/runtime deps from `01-architecture-layout.md` §3.
2. **Author `tools.manifest.json` with a custom `config` block.** Because every path
   and the target list are config (`EmitterConfig`, `00` §2.3), the only change needed
   is the config values — no source edits:

   ```jsonc
   {
     "version": 1,
     "config": {
       "skillsDir": "prompts",          // non-default canonical root
       "agentsDir": "agents",
       "commandsDir": "commands",
       "referencesDir": "shared/refs",
       "scriptsDir": "shared/scripts",
       "overridesDir": "overrides",
       "adaptersDir": "adapters",
       "targets": ["claude", "codex", "cursor"]   // a different/narrower target set
     },
     "tools": [
       { "name": "my-tool", "type": "skill", "source": "prompts/my-tool/SKILL.md" }
     ]
   }
   ```

3. **Run `bun run build`.** The emitter reads paths and the target set from
   `Manifest.config`, discovers under `prompts/`, and writes `adapters/claude/`,
   `adapters/codex/`, `adapters/cursor/` plus `.claude-plugin/` — all without any
   `agent-docs`-specific literal. `CON-04` fixes the v1 target SET for `agent-docs`,
   but it is expressed as config so another repo narrows or reorders it.
4. **Wire `bun run build:check` (the drift guard) into that repo's CI** (CON-05 is an
   `agent-docs` delivery mandate; an adopter wires it the same way).

### 5.4 Reuse boundaries

- **No CLI install / no global binary** (OOS-04). The `bin` entry in `package.json`
  (`01` §3) is for local `bun run`, not a published, globally-installed tool.
- **No publishing/release automation** (OOS-03). The plugin manifests are _generated_;
  pushing them to a marketplace is out of scope.
- The reuse contract is the **config surface + the three barrel functions** — it is a
  design requirement (REQ-REUSE-01), not a packaged product.

### 5.5 Verification of reuse

- [ ] Pointing `Manifest.config.skillsDir` at a non-default dir and rebuilding emits
      from that dir with no source edits (REQ-REUSE-01).
- [ ] Setting `Manifest.config.targets` to a subset emits exactly that subset, in the
      given order.
- [ ] `grep -ri "agent-docs" src/` finds no path/target literal (only package
      identity); confirms no hardcoding (`01` §verification).
- [ ] `import { loadManifest, emit, driftCheck, emitPlugin } from "agent-docs-scaffold"`
      resolves against `dist/` (barrel, `01` §5).

## 6. The MVP sample skill — `docs-helper` (OQ-04, SC-02, REQ-TOOLS-01)

### 6.1 What it is

The single end-to-end proof tool is a small, real **skill** named **`docs-helper`**: a
documentation-writing helper that reminds the agent of the repo's doc conventions and
points at a shared style reference. It is a skill (not an agent/command) because skills
are REQ-TOOLS-01 (the primary tool type) and exercise the richest transform surface:
frontmatter shaping, a skill-owned reference file copied verbatim, and per-target
metadata drops. It is deliberately minimal so its golden output is reviewable by hand.

> This is the workshop's proof, not a real product tool (OOS-01 keeps real tools out of
> scope). `docs-helper` exists to make SC-02/SC-08 testable; it is the only tool the
> MVP must ship end-to-end across all five targets.

### 6.2 Canonical files

Authored under the canonical (Claude-native) source root (`skillsDir`, default
`skills/`). The skill owns **one** reference file.

**`skills/docs-helper/SKILL.md`** (canonical, Claude-native; frontmatter shape per
`03-discovery-and-canonical-model.md` TQ-3 resolution — extras nested under
`metadata`):

```markdown
---
name: docs-helper
description: Helps write and review project documentation following the repo's house style. Use when authoring or editing docs, READMEs, or reference pages.
metadata:
  argument-hint: "[doc-path]"
  allowed-tools: Read, Edit, Write
---

# docs-helper

Assist with writing and reviewing documentation for this repository.

## When to use

Use when the user is authoring or editing documentation — READMEs, reference
pages, or guides — and wants it to match the project's house style.

## How to help

1. Read the target document (and `references/style-guide.md` in this skill).
2. Check it against the house-style checklist below.
3. Propose concrete edits; do not rewrite wholesale without asking.

## House-style checklist

- One sentence per line for prose; wrap at ~90 columns.
- Headings are sentence-case.
- Every code block declares a language.
- Link to the canonical source, not a copy.

See `references/style-guide.md` for the full rules.
```

**`skills/docs-helper/references/style-guide.md`** (skill-owned reference, copied
verbatim to every target — a `VerbatimRecord`, `00-core-definitions.md` §3.4):

```markdown
# House style guide

## Prose
- One sentence per line.
- Wrap prose at roughly 90 columns.
- Prefer active voice.

## Structure
- Sentence-case headings.
- A single H1 per document.
- Reference sections link to the canonical source.

## Code
- Every fenced block declares a language.
- Show realistic, runnable examples.
```

### 6.3 Manifest registration

The sample skill is registered in `tools.manifest.json` (schema owned by
`02-manifest-and-config.md`; `ToolEntry` shape in `00-core-definitions.md` §2.2):

```jsonc
{
  "name": "docs-helper",
  "type": "skill",
  "source": "skills/docs-helper/SKILL.md",
  "description": "Helps write and review project documentation following the repo's house style."
}
```

No `targets` overrides and no `overrides/` entries — the sample is the **common case**
(SC-01): authored once, emitted everywhere with no hand-editing.

## 7. Correct emission per target (OQ-04, SC-02/SC-08, REQ-EMIT-07)

"Correct" output is defined entirely by applying the per-target rules in
`04-transforms.md` (§6–§10) to the canonical files in §6.2. The byte-exact files live
in `src/test/__golden__/<target>/…` and are asserted by `08-testing-strategy.md`; this
section specifies, per target, the **emitted relpaths**, the **frontmatter shape**, the
**verbatim reference copy**, and the **expected `DropRecord`s** so the golden author and
a reviewer know what correct looks like. Relpaths below are adapter-subtree-relative
(i.e. under `adapters/<target>/`), matching the `TransformOutput.relpath` values in
`04-transforms.md`.

### 7.1 claude (canonical — NO drops; `04-transforms.md` §6)

- **Skill file**: `skills/docs-helper/SKILL.md` — frontmatter
  `{ name, description, argument-hint? }` **plus full `metadata`** (incl.
  `allowed-tools`), key-ordered per `KEY_ORDER`. Provenance **Form A** comment as the
  first line inside the `---` block.
- **Verbatim**: `skills/docs-helper/references/style-guide.md` copied byte-identical
  (no provenance header — it is a `VerbatimRecord`).
- **Drops**: **none**. The Claude target is canonical (`04` §6).

This `adapters/claude/skills/docs-helper/…` tree is also half the installable plugin
bundle (§3.1).

### 7.2 codex (`04-transforms.md` §7)

- **Skill file**: `skills/docs-helper/SKILL.md` — markdown + YAML frontmatter reduced
  to `{ name, description }`.
- **Verbatim**: the `references/style-guide.md` copy.
- **Drops** (`DropRecord`, kind `fallback`): the skill `metadata` (the
  `argument-hint` and `allowed-tools`) — Codex skill frontmatter reads only
  `{ name, description }` (`04` §7.2). Reason string per `04` §7.2.

### 7.3 cursor (`04-transforms.md` §8)

- **Skill file**: emitted as a Cursor **rule** at `rules/docs-helper.mdc` (MUST be
  `.mdc`), frontmatter `{ description, globs: [], alwaysApply: false }`. The skill
  `name` survives only as the filename.
- **Verbatim**: the `references/style-guide.md` copy is carried alongside the rule as a
  skill-owned verbatim record (`04-transforms.md §4.6` — "Skill-owned references /
  verbatim copies"). Because the skill is flattened to a `rules/<n>.mdc` rule, the exact
  relpath the verbatim `references/` files land under is defined by `04` §4.6, which is
  authoritative for the chosen cursor verbatim relpath; this section defers to that path
  rather than asserting a specific one here.
- **Drops** (`fallback`): `name` (now only in filename), the `metadata`
  (`argument-hint`, `allowed-tools`) — no Cursor `.mdc` field for these (`04` §8.2).

### 7.4 gemini (`04-transforms.md` §9)

- **Skill file**: `skills/docs-helper/docs-helper.md` (`{ name, description }`).
- **Aggregate**: a `gemini-extension.json` entry registering the skill (provenance
  **Form C** `_generated` key), per `04` §9.3.
- **Verbatim**: the `references/style-guide.md` copy.
- **Drops** (`fallback`): `metadata` (`argument-hint`, `allowed-tools`) — Gemini skill
  frontmatter carries only `{ name, description }` (`04` §9.1).

### 7.5 copilot (`04-transforms.md` §10)

- **Skill file**: `instructions/docs-helper.instructions.md`, frontmatter
  `{ description, applyTo: "**" }`. The skill `name` survives only as the filename.
- **Verbatim**: the `references/style-guide.md` copy.
- **Drops** (`fallback`): `name` (filename only), `metadata` (`argument-hint`,
  `allowed-tools`) — no Copilot instructions field for these (`04` §10.1).

### 7.6 Coverage-report expectation (REQ-EMIT-03, REQ-VALID-05)

Because the sample skill drops `metadata` on every non-Claude target, a correct build's
`adapters/GENERATION-REPORT.md` (rendered from `ReportModel`, `00` §3.5) MUST show, for
`docs-helper`:

- `perTarget.claude`: `emitted: 1`, `fallback: 0`, `verbatim: 1`.
- `perTarget.{codex,cursor,gemini,copilot}`: `emitted: 1`, `fallback >= 1`,
  `verbatim: 1`.
- `drops[]` containing one `fallback` `DropRecord` per non-Claude target for the
  dropped `metadata` (and, for cursor/copilot, the `name`-in-filename fallback), with
  `source: "skills/docs-helper/SKILL.md"`.

This makes SC-06 demonstrable on the sample tool alone, and ties the sample to
REQ-EMIT-03's "no silent drops" guarantee.

## 8. Verification (this document)

Packaging (also §4) and sample-skill correctness:

- [ ] `emitPlugin(meta)` returns exactly two `EmittedFile`s with the §3.3 shapes;
      same `meta` ⇒ byte-identical output (REQ-EMIT-06).
- [ ] The committed `.claude-plugin/plugin.json` and `marketplace.json` match
      `emitPlugin`'s output (drift guard passes; requires `06` to guard
      `.claude-plugin/`).
- [ ] `skills/docs-helper/SKILL.md` + `references/style-guide.md` exist and the
      `docs-helper` `ToolEntry` is in `tools.manifest.json`.
- [ ] `bun run build` emits a `docs-helper` skill file for **all five** targets at the
      §7 relpaths, plus the verbatim reference copy under each target (SC-02).
- [ ] Each non-Claude target produces at least one `fallback` `DropRecord` for the
      dropped `metadata`; Claude produces none (§7.6, REQ-EMIT-03).
- [ ] Golden snapshots in `src/test/__golden__/<target>/…` (owned by
      `08-testing-strategy.md`) match the live emit for `docs-helper` on every target
      (SC-08).
- [ ] Reuse: changing `Manifest.config` paths/targets re-points the emitter with no
      source edit (§5.5).

## Cross-references

- `00-core-definitions.md` — `Manifest`/`EmitterConfig`/`EmitResult`/`EmittedFile`/
  `Target`/`ToolEntry`, `PROVENANCE`/`REGEN_CMD`/`TARGET_ORDER`, error hierarchy.
- `01-architecture-layout.md` — `src/plugin.ts` placement, `.claude-plugin/` tree,
  `package.json` (name/version), barrel `src/index.ts` (`loadManifest`/`emit`/
  `driftCheck`).
- `02-manifest-and-config.md` — manifest schema (incl. optional `config.plugin`
  extension) and the `docs-helper` `ToolEntry`.
- `04-transforms.md` — per-target transform rules applied to the sample skill in §7;
  the `adapters/claude/` tree as half the plugin bundle.
- `05-overrides-publish-determinism.md` — writes `emitPlugin`'s files atomically;
  emit assembly of `PluginMeta`.
- `06-validation-and-drift-guard.md` — MUST add `.claude-plugin/` to guarded roots
  (§3.5).
- `08-testing-strategy.md` — owns the byte-exact `__golden__/` files described in §7.
