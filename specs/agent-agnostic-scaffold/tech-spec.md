# Agent-Agnostic Scaffold — Technical Specification

## 1. Overview

This feature bootstraps a **canonical-core + adapters** authoring system in the
`agent-docs` repo. Tools are authored once in Claude-native form (the canonical
source), enumerated in an explicit tool manifest, and transformed by a
**Bun + TypeScript emitter** into committed per-target adapter bundles for Codex,
Cursor, Gemini, and Copilot. A drift guard keeps committed adapters honest.

Key architectural decisions:

- **Port, don't reuse.** feature-forge's `scripts/build-adapters.py`
  (`/home/gary/workspace/feature-forge/`) is a proven, complete implementation of
  this exact pattern. We reimplement its design in TypeScript per CON-01 — the
  data models, fixed key-emission order, atomic publish, drop-records, provenance
  headers, and per-target manifests all carry over. (REQ-STRUCT-03, REQ-EMIT-02)
- **Bun+TS is the CON-01 org mandate** (not a rauf-derived convention). Note that
  rauf is itself a **pnpm workspace monorepo** (`packageManager: pnpm@9.15.0`,
  `engines.node >=22`); it uses Bun only as a `.bun-version`/`bun.lock` script
  runner. What we genuinely **adopt from rauf** are its per-tool TypeScript
  conventions — TS 5.7 tsconfig, **vitest**, **Zod + zod-to-json-schema** with the
  `generate-json-schemas.ts --check` schema-guard pattern, ESLint 9 +
  typescript-eslint, Prettier — not its package manager or monorepo topology.
  agent-docs is a single-package Bun project. (CON-01)
- **Four additive capabilities over feature-forge:** an explicit schema-validated
  tool manifest (REQ-DISC), slash commands as a first-class tool type
  (REQ-TOOLS-03), per-target override slots in a separate tree (REQ-EMIT-04), and
  checked-in golden snapshots + a coverage report (REQ-VALID-04/05).
- **Canonical source at repo root**, mirroring the reference impl.

The actual documentation tools are out of scope (OOS-01); this spec builds the
workshop. One real sample **skill** is the MVP end-to-end proof (SC-02, OQ-04).

## 2. Module Structure

Project location: the `agent-docs` repo root becomes a single-package Bun+TS
project (no monorepo; CON-01, REQ-STRUCT-01). Layout:

```
agent-docs/
  package.json                    # type: module, Bun+TS, scripts (see §9)
  tsconfig.json                   # extends rauf conventions (§3.1)
  vitest.config.ts                # include src/**/*.test.ts
  eslint.config.mjs  .prettierrc  # rauf-matched lint/format
  bun.lock  .bun-version          # Bun 1.3.10

  tools.manifest.json             # config block + canonical tool registry (REQ-DISC-01, REQ-REUSE-01)
  schemas/
    tools.manifest.schema.json    # generated from Zod (committed; REQ-DISC-03)

  # --- canonical (Claude-native) source — single source of truth (REQ-STRUCT-03)
  skills/<name>/SKILL.md          # + references/, scripts/ owned by the skill
  agents/<name>.md
  commands/<name>.md              # slash commands (REQ-TOOLS-03)
  references/…                    # shared references (REQ-TOOLS-04)
  scripts/…                       # shared scripts (REQ-TOOLS-04)

  # --- author-supplied per-target overrides (REQ-EMIT-04)
  overrides/<target>/<relpath>    # files that replace emitted output at <relpath>

  # --- generated, committed output (REQ-STRUCT-02)
  adapters/
    GENERATION-REPORT.md          # coverage report (REQ-VALID-05)
    claude/  codex/  copilot/  cursor/  gemini/
  .claude-plugin/                 # plugin.json + marketplace.json (REQ-PKG-01)

  # --- emitter implementation
  src/
    index.ts                      # barrel
    cli.ts                        # `build`, `build --check` entrypoints (REQ-EMIT-01)
    manifest.ts                   # Zod schema + load/validate (REQ-DISC)
    discover.ts                   # read canonical source per manifest entry
    model.ts                      # SkillRecord/AgentRecord/CommandRecord/EmitResult
    targets/                      # one transform module per target
      claude.ts codex.ts copilot.ts cursor.ts gemini.ts
    emit.ts                       # orchestrate: discover → transform → merge overrides
    overrides.ts                  # load + merge overrides/ tree (REQ-EMIT-04)
    publish.ts                    # atomic write + stale cleanup (REQ-EMIT-05/08)
    driftguard.ts                 # re-emit + diff committed adapters (REQ-VALID-01)
    report.ts                     # coverage/drop report (REQ-VALID-05)
    errors.ts                     # named error hierarchy
    test/                         # vitest, incl. golden snapshot of sample tool
      __golden__/<target>/…       # checked-in expected output (REQ-VALID-04)
```

Public API surface: the emitter is invoked via package scripts (`bun run build`,
`bun run build --check`); `src/index.ts` re-exports the core functions
(`loadManifest`, `emit`, `driftCheck`) for programmatic reuse (REQ-REUSE-01).

## 3. Technical Decisions

### 3.1 Stack & toolchain — port to Bun+TS per CON-01, reuse rauf's TS conventions (CON-01, REQ-REL-01)

Reimplement feature-forge's emitter design in TypeScript. Bun+TS is mandated by
CON-01 (an org/toolchain mandate). rauf is a **pnpm monorepo**, so we do not mirror
its package-manager or workspace topology — agent-docs is a single-package Bun
project. What we adopt from rauf are its per-tool TypeScript settings, verbatim:

- **tsconfig**: target ES2022, module ESNext, moduleResolution bundler, `strict`,
  `noUncheckedIndexedAccess`, `resolveJsonModule`, `types: ["bun-types"]`.
- **Tests**: **vitest** (`vitest run`), test files co-located as `src/**/*.test.ts`.
  Chosen over `bun:test` explicitly to match rauf (the project standard), per the
  user decision.
- **Schema**: **Zod** for runtime validation + **zod-to-json-schema** to generate
  the committed JSON Schema — the identical pattern rauf uses in
  `generate-json-schemas.ts`, and it directly satisfies REQ-DISC-03.
- **Lint/format**: ESLint 9 + typescript-eslint; Prettier (`semi: true`,
  `singleQuote: false`, `trailingComma: "all"`, `printWidth: 100`, `tabWidth: 2`).

_Alternative considered:_ `bun:test` (fewer deps) and keeping the Python emitter
(zero port cost) — both rejected: `bun:test` diverges from rauf, and Python
violates CON-01.

### 3.2 Repository layout — canon at repo root (REQ-STRUCT-01/02/03)

Canonical source lives at the repo root (`skills/`, `agents/`, `commands/`,
`references/`, `scripts/`), mirroring feature-forge so the proven discovery and
transform logic ports cleanly. Generated adapters live in the committed
`adapters/<target>/` tree (REQ-STRUCT-02, CON-02). The Claude adapter
(`adapters/claude/`) plus `.claude-plugin/` doubles as the installable plugin
bundle (REQ-PKG-01), exactly as feature-forge does.

### 3.3 Tool manifest — JSON, Zod-validated (REQ-DISC-01/02/03)

`tools.manifest.json` is the **single source of truth for which tools exist**,
feeding both the emitter and the drift guard (REQ-DISC-02) so the tool set cannot
diverge between emit and check. This is the key addition over feature-forge, which
globs the filesystem.

- Hand-authored JSON, validated at load against a Zod schema (`src/manifest.ts`).
- A committed `schemas/tools.manifest.schema.json` is generated from the Zod
  schema via `zod-to-json-schema` for editor support and is itself drift-guarded
  (regenerate-and-diff in `--check`), matching rauf's `schema:check`.
- See §4 for the manifest schema.

_Alternatives considered:_ a `tools.manifest.ts` module (compile-time safety, but
not language-neutral and opaque to non-TS tooling) and YAML (friendlier edits, but
adds a YAML read dependency). JSON+Zod chosen for tooling-agnostic readability and
the existing rauf precedent.

### 3.4 Override slots — separate `overrides/` tree, file-level (REQ-EMIT-04/05, addresses V-005)

Author-supplied overrides live in `overrides/<target>/<relpath>`, **outside** the
generated `adapters/` tree. During emit, after transform, the emitter overlays
each override file onto the generated output at the matching `adapters/<target>/<relpath>`
(file-level replace). This makes overrides **deterministically distinguishable**
from emitted content (REQ-EMIT-04 / V-005): the drift guard knows that any
`adapters/` file whose path matches an `overrides/` entry is author-sourced, and
re-applies overrides the same way during `--check` (REQ-VALID-01) so legitimate
overrides never read as drift.

- Overrides are merged at file granularity (whole-file replace), not section
  merge — simpler to keep byte-stable and drift-distinguishable. Section-merge is
  explicitly out of scope this version (closes OQ-03 at file-level).
- Overridden files carry no "generated" provenance header (they are author
  content); the coverage report lists them under an `Overridden` section.
- A hand-edit to an emitted (non-overridden) `adapters/` file still fails the
  drift guard (SC-04); declaring an override is the sanctioned escape hatch (SC-05).
- A **stale override** (one targeting a path the emitter no longer emits, e.g.
  after a tool rename/removal) is a **non-fatal warning**, not a build failure: it
  is listed under `staleOverrides` in GENERATION-REPORT.md and the build continues.
  This mirrors the auto-cleanup posture for emitted orphans (REQ-EMIT-08) and
  honors REQ-EMIT-05's no-manual-cleanup intent for author content (see §7).

### 3.5 Transform rules — adopt feature-forge table, best-effort for commands (REQ-EMIT-02/03)

Reuse feature-forge's verified per-target transform rules verbatim for skills,
agents, references, and scripts (see §5 for the table). Slash commands
(REQ-TOOLS-03) are new:

- **Claude**: `commands/<name>.md` emitted with full frontmatter (native).
- **Cursor**: emit to Cursor's native command file format where representable.
- **Codex / Gemini / Copilot**: no confirmed native slash-command construct →
  **best-effort fallback** to an instruction document, with a **drop/fallback
  record** (REQ-EMIT-03). Exact per-target command file naming/format is finalized
  in forge-3-specs (see §10 TQ-1), grounded in the targets' docs rather than
  guessed.

Per REQ-EMIT-03 (post-fix): every construct with no faithful target equivalent
**must** produce a coverage-report entry (`fallback` or `skipped`) and a warning —
no silent drops. The "nearest representable equivalent" is a non-gating design
goal (REQ-EMIT-03a).

### 3.6 Determinism, idempotency & stale cleanup (REQ-EMIT-05/06/08, REQ-REL-01)

Carry over feature-forge's determinism guarantees and extend them:

- **Fixed key-emission order** for frontmatter:
  `name, description, argument-hint, globs, alwaysApply, tools, model, maxTurns, effort, memory, skills`.
- Stable POSIX-path sort of discovered tools; no timestamps in output; byte-stable
  YAML/JSON serialization (stable key order, no reflow).
- **Byte-stable over both inputs**: identical canonical source **and** identical
  override contents yield byte-identical adapters (REQ-EMIT-06, post-fix).
- **Atomic publish** (`publish.ts`): build into a temp staging dir, then replace
  `adapters/` via `fs.rename`/`fs.cp`+swap so a failed run never leaves a partial
  tree.
- **Stale cleanup** (REQ-EMIT-08): publish replaces the whole `adapters/` subtree
  from the freshly computed file set, so removing/renaming a tool in the manifest
  drops its orphaned adapter files automatically. The drift guard additionally
  fails on orphans — committed adapter files with no corresponding emitted file
  (see §3.7).
- **Write confinement** (REQ-SEC-01): `publish.ts` and `overrides.ts` resolve every
  output path and **confine all writes** to the staging dir and the `adapters/`
  tree; any path resolving outside those roots (e.g. a `../` in a manifest `source`
  or override relpath) is refused with `PathEscapeError` (§7) rather than written.
  This ports feature-forge's `allowed_root` containment guard. Reads are likewise
  limited to the canonical source and declared override slots.

### 3.7 Validation stack — drift guard primary, goldens for the sample tool (REQ-VALID-01/04/05)

- **Drift guard (P0 gate, REQ-VALID-01):** `build --check` re-emits to a temp dir
  (overrides merged identically to a normal build), then compares against committed
  `adapters/`. Mismatch → exit non-zero with a per-file diff and remediation
  message (REQ-OBS-02). The comparison is **set-based + content-based**: it fails
  on (a) content differences and (b) **orphan files** present in committed
  `adapters/` but absent from the fresh emit (REQ-EMIT-08, SC-05a). Runnable
  locally and in CI; CI execution is mandated by CON-05.
- **Golden snapshots (REQ-VALID-04):** scoped to the MVP **sample skill** — its
  expected per-target output is checked into `src/test/__golden__/` and asserted by
  vitest. This is a focused transform-regression test, not a parallel copy of every
  tool's output (the drift guard already covers the whole tree). Per the user
  decision, goldens are the sample tool's surface, not the primary test for all
  tools.
- **Coverage / capability report (REQ-VALID-05, REQ-OBS-01):** every build writes
  `adapters/GENERATION-REPORT.md` from the `ReportModel` (§4.2): `toolsProcessed`,
  per-target counts (emitted / fallback / skipped / overridden / verbatim), the
  `drops` list, and `staleOverrides`. This surfaces exactly REQ-OBS-01's required
  data (targets emitted, tools processed, fallbacks applied, items skipped). The
  report is itself committed and drift-guarded.
- **Per-target schema validation (REQ-VALID-03):** where a target defines a
  manifest schema (codex `openai.yaml`, gemini `gemini-extension.json`), validate
  the emitted manifest against it.

### 3.8 Packaging & reusability — design for reuse, don't extract (REQ-PKG-01, REQ-REUSE-01)

- Emit `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` so the
  canonical Claude side is an installable plugin (REQ-PKG-01), following
  feature-forge's manifest shapes.
- Keep the emitter **config-driven and path-agnostic** (no `agent-docs`
  hardcoding) so it is reusable in other repos (REQ-REUSE-01). The concrete config
  surface is a top-level **`config` block in `tools.manifest.json`** (single source
  of truth, one Zod schema — see §4.1): it declares the canonical root dirs
  (`skillsDir`, `agentsDir`, `commandsDir`, `referencesDir`, `scriptsDir`), the
  `overridesDir` and `adaptersDir` paths, and the `targets` list. `cli.ts` and
  `emit.ts` read all paths and the target set from this config rather than from
  constants — so `adapters/claude/...`-style literals and the
  `claude,codex,copilot,cursor,gemini` target list in §5.2 are config-sourced
  defaults, not hardcoded. CON-04 fixes the target SET for v1, but it is expressed
  as config so another repo can vary it. The emitter ships in-repo; **no** standalone
  published CLI this version (respects OOS-04). The user chose "design for reuse,
  don't extract."

## 4. Data Model

### 4.1 Tool manifest (Zod schema → `tools.manifest.json`)

```ts
const ToolType = z.enum(["skill", "agent", "command", "script", "reference"]);

const TargetOverrides = z.record(
  z.enum(["codex", "cursor", "gemini", "copilot", "claude"]),
  z.object({
    exclude: z.boolean().optional(),        // skip this tool for this target
    // file-level override declarations are discovered from overrides/<target>/,
    // not enumerated here; this slot is for per-target mapping flags
  }).optional()
);

const ToolEntry = z.object({
  name: z.string(),                         // kebab-case; matches source path
  type: ToolType,
  source: z.string(),                       // repo-relative path to canonical file/dir
  description: z.string().optional(),
  targets: TargetOverrides.optional(),      // per-target overrides/exclusions (REQ-DISC-01)
});

const Target = z.enum(["claude", "codex", "copilot", "cursor", "gemini"]);

// Emitter config surface — single source of truth for paths + targets (REQ-REUSE-01).
// Defaults match the repo-root layout (§2); another repo overrides them here.
const EmitterConfig = z.object({
  skillsDir: z.string().default("skills"),
  agentsDir: z.string().default("agents"),
  commandsDir: z.string().default("commands"),
  referencesDir: z.string().default("references"),
  scriptsDir: z.string().default("scripts"),
  overridesDir: z.string().default("overrides"),
  adaptersDir: z.string().default("adapters"),
  targets: z.array(Target).default(["claude", "codex", "copilot", "cursor", "gemini"]),
});

const Manifest = z.object({
  version: z.literal(1),
  config: EmitterConfig.default({}),       // paths + target list (REQ-REUSE-01)
  tools: z.array(ToolEntry),
});
```

`cli.ts`/`emit.ts` source every path and the target set from `Manifest.config`; no
emitter module hardcodes a root path or the target list.

### 4.2 Emitter records (ported from feature-forge)

- `SkillRecord { name, description, metadata, body, ownRefs, sourcePath }`
- `AgentRecord { name, description, body, claudeKeys (ordered), sourcePath }`
- `CommandRecord { name, description, argumentHint?, body, sourcePath }` _(new)_
- `EmittedFile { relpath, content, mode }`
- `DropRecord { target, source, construct, reason }`
- `ManifestEntry { name, description, extra }` (codex/gemini aggregate manifests)
- `VerbatimRecord { relpath, sourcePath }` — files copied byte-identical (no provenance header)
- `EmitResult { files: EmittedFile[], drops: DropRecord[], manifestEntries, overridden: string[], verbatim: VerbatimRecord[] }`
- `ReportModel` (what GENERATION-REPORT.md renders, REQ-OBS-01/REQ-VALID-05):
  `{ toolsProcessed: {name, type}[], perTarget: { target → { emitted, fallback, skipped, overridden, verbatim: number } }, drops: DropRecord[], staleOverrides: string[] }`
- `DriftEntry { relpath, kind: "content" | "orphan" | "missing" }` — structures
  REQ-OBS-02's "which files differ and **how**" (content = differs, orphan =
  committed but not emitted, missing = emitted but not committed)

## 5. API Design

### 5.1 CLI surface (REQ-EMIT-01)

- `bun run build` → regenerate all adapters from canonical source + overrides.
- `bun run build --check` → drift guard; non-zero exit on drift/orphan (REQ-VALID-01).
- `bun run schema:check` → regenerate manifest JSON Schema and diff (REQ-DISC-03).

### 5.2 Per-target transform table (ported, verified from feature-forge source)

| Target | Skill file | Skill frontmatter | Agent file | Aggregate manifest | Dropped |
|--------|-----------|-------------------|------------|--------------------|---------|
| claude | `skills/<n>/SKILL.md` | `{name, description, argument-hint?}` | `agents/<n>.md` full claudeKeys | — | none |
| cursor | `skills/<n>/<n>.mdc` | `{description, globs:[], alwaysApply:false}` | `agents/<n>.mdc` same shape | — | argument-hint, agent claudeKeys |
| codex | `skills/<n>/<n>.md` | `{name, description}` | `agents/<n>.md` `{name,description}` | `agents/openai.yaml` | argument-hint, agent claudeKeys |
| copilot | `skills/<n>/<n>.md` | `{name, description}` | `agents/<n>.md` `{name,description}` | — | argument-hint, agent claudeKeys |
| gemini | `skills/<n>/<n>.md` | `{name, description}` | `agents/<n>.md` `{name,description}` | `gemini-extension.json` | argument-hint, agent claudeKeys |

Slash-command rows are added per §3.5; exact target formats finalized in
forge-3-specs (TQ-1). Fixed target emission order: `claude, codex, copilot,
cursor, gemini`.

### 5.3 Provenance forms (ported)

- **Form A** (YAML-frontmatter files): first line inside `---` block —
  `# GENERATED — DO NOT EDIT. Source: {source}. Regenerate: bun run build`.
- **Form B** (frontmatter-less markdown, e.g. GENERATION-REPORT.md): HTML comment
  at top.
- **Form C** (strict JSON, gemini-extension.json): top-level `_generated:
  {source, regenerate}` first key.

Overridden files carry no provenance header (author content; §3.4).

## 6. Integration Points

This is a greenfield project — there are **no existing packages in `agent-docs`**
to import from or that import from it. Integration is with two **reference**
codebases (read-only design inputs, not runtime deps):

- **feature-forge** (`/home/gary/workspace/feature-forge/`): the design source.
  Port `scripts/build-adapters.py` (data models, transform rules, provenance,
  atomic publish, drift guard) and the manifest shapes in `.claude-plugin/`. The
  `installer/src/` module layout (`manifest.ts`, `apply.ts`, `plan.ts`,
  `report.ts`, `hash.ts`, …) is a structural template for `src/`.
- **rauf** (`/home/gary/workspace/rauf/`): the convention source — tsconfig,
  vitest config, `generate-json-schemas.ts` (Zod→JSON-Schema + `--check`),
  ESLint/Prettier configs, package-script naming (`build`, `typecheck`, `lint`,
  `schema:check`, `gate`).

WARNING: feature-forge has **no tool manifest, no override mechanism, no slash-command
emission, and no golden snapshots** — these four are net-new and have no reference
implementation to port. Design them fresh against the PRD.

Downstream: the future doc-site feature and the actual doc tools (OOS-01/02) will
consume this scaffold by authoring into the canonical tree and registering in the
manifest; no code coupling is defined here.

## 7. Error Handling

Named error hierarchy in `src/errors.ts` extending `Error` (matching
feature-forge's `CanonError`/`MalformedFrontmatterError` and rauf's `errors.ts`):

- `ManifestValidationError` — manifest fails Zod validation (path + Zod issue list).
- `MalformedFrontmatterError` — a canonical file has unparseable/invalid frontmatter.
- `SourceNotFoundError` — a manifest entry's `source` path does not exist.
- `PathEscapeError` (fatal) — a `source` or override relpath resolves outside the
  canonical/staging/`adapters/` roots; refused rather than written (REQ-SEC-01, §3.6).
- `DriftError` — `--check` found drift; carries a `DriftEntry[]` (§4.2) so the
  message identifies each file **and its kind** (`content` / `orphan` / `missing`)
  plus remediation (`run bun run build`) (REQ-OBS-02).

**Stale overrides are NOT a fatal error.** When an override in `overrides/<target>/`
targets a path the emitter no longer emits (e.g. after a tool rename/removal), the
build **warns and continues**, listing the stale override under `staleOverrides` in
GENERATION-REPORT.md (§4.2 `ReportModel`). This is deliberate: it keeps the
emitted-orphan auto-cleanup posture (REQ-EMIT-08) and the "MUST NOT require manual
cleanup between runs" intent (REQ-EMIT-05) symmetric for author content, and is
consistent with REQ-EMIT-03's "warn, don't silently drop." (No `OverrideConflictError`
is raised for this case.)

Emit warnings (non-fatal) for every fallback/skip (REQ-EMIT-03) and stale override.
Fatal errors (validation, malformed frontmatter, missing source, path escape, drift
in `--check`) exit non-zero without writing a partial `adapters/` tree (atomic
publish, §3.6).

## 8. Testing Approach

- **Framework**: vitest (`vitest run`), `src/**/*.test.ts` co-located.
- **Unit**: manifest Zod validation (valid/invalid fixtures); each target
  transform (frontmatter shaping, key-order, dropped keys); override merge
  (replace + distinguishability); provenance header forms.
- **Golden snapshot (REQ-VALID-04)**: emit the MVP sample skill and assert
  byte-equality against `src/test/__golden__/<target>/…`.
- **Determinism (REQ-EMIT-05/06, SC-03)**: emit twice → zero diff; emit → `--check`
  → clean.
- **Drift/orphan (SC-04/SC-05a)**: mutate a committed adapter → `--check` fails;
  remove a tool from the manifest → orphan detected; declare an override → survives
  rebuild and `--check` passes (SC-05).
- **Schema drift**: `schema:check` regenerates and matches the committed JSON
  Schema.
- No hard coverage % target (small surface); the `gate` script
  (`build && schema:check && typecheck && lint && format:check && test`) is the
  CI bar.

## 9. Dependencies

External (dev/runtime, versions matched to rauf):

- `typescript` ^5.7, `bun-types`, Bun 1.3.10 runtime
- `zod` ^3.24, `zod-to-json-schema`
- `yaml` (YAML serialization for frontmatter + codex `openai.yaml`; byte-stable
  options)
- `vitest` ^3, `eslint` 9 + `typescript-eslint`, `prettier` ^3

Internal: none (greenfield). No production dependency on feature-forge or rauf —
they are design references only.

## 10. Open Technical Questions

- **TQ-1** (forge-3-specs): Exact native slash-command file format/location for
  Cursor, Codex, Gemini, Copilot (REQ-TOOLS-03, §3.5). Claude is native; others are
  best-effort fallback pending confirmation from each target's docs. Carries the
  feature-forge gap that Copilot has no confirmed aggregate manifest format.
- **TQ-2** (forge-3-specs): Whether structural agent keys (`tools`, `model`, etc.)
  have any representable equivalent on Codex (`openai.yaml`) — feature-forge marks
  this unconfirmed and currently drops them. Default: drop with record.
- **TQ-3**: Exact `metadata`/`allowed-tools` handling for skills per target
  (feature-forge relocates `argument-hint` into `metadata`); confirm canonical
  frontmatter shape for agent-docs skills during specs.
- **TQ-4**: Whether the manifest should also schema-validate that each `source`
  path's on-disk frontmatter agrees with the manifest `type`/`name` (cross-check),
  or trust the manifest. Leaning: cross-check and error on mismatch.
- **OQ-05 (from PRD)**: Plugin/marketplace manifest specifics for the installable
  Claude package — resolve against feature-forge's `.claude-plugin/` shapes in
  specs.
