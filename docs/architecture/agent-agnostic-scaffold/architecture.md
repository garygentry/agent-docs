# Architecture

This document explains how the emitter is built: the pipeline stages, the data that
flows between them, the determinism model that makes output byte-stable, and the
contract every target transform implements.

## 1. The pipeline at a glance

A build is a single in-memory pipeline followed by an atomic disk write. The CLI
(`src/cli.ts`) is the only module that touches `process.argv` and sets exit codes;
every stage it calls is a pure(ish) function that **throws** typed errors rather
than exiting.

```
tools.manifest.json ─┐
                     ▼
            loadManifest()      src/manifest.ts   ── Zod validate + manifest↔source cross-check
                     │  Manifest
                     ▼
            resolveConfig()     src/config.ts     ── manifest.config → absolute ResolvedRoots
                     │  ResolvedRoots
                     ▼
            discover()          src/discover.ts   ── parse canonical sources → typed records
                     │  { skills[], agents[], commands[], sharedRefs[], sharedScripts[] }
                     ▼
            emit()              src/emit.ts       ── run every TargetTransform over every record
                     │  EmitResult { files[], drops[], manifestEntries[], verbatim[] }
                     ▼
            loadOverrides()  +  applyOverrides()  src/overrides.ts  ── overlay overrides/<target>/…
                     │  { files[], overridden[], staleOverrides[] }
                     ▼
            buildReportModel() + renderReport()   src/report.ts     ── adapters/GENERATION-REPORT.md
                     │
                     ├─► emitPlugin()             src/plugin.ts     ── .claude-plugin/{plugin,marketplace}.json
                     ▼
            publish()           src/publish.ts    ── atomic write of the whole adapters/ subtree
```

`build` and `build --check` share the same `prepare()` function in `src/cli.ts`, so
the bytes written by a build and the bytes diffed by the drift guard come from one
code path — there is no second renderer that could disagree.

## 2. Stage-by-stage

### 2.1 Load & validate the manifest (`src/manifest.ts`)
`loadManifest(path, repoRoot)` parses `tools.manifest.json`, validates it against
the `Manifest` Zod schema (`src/model.ts`), and runs the **manifest↔source
cross-check** (`TQ-4`): every tool's `source` must exist on disk, and every skill's
`SKILL.md` frontmatter `name` must equal its manifest `name`. Failures throw
`ManifestValidationError` / `SourceNotFoundError` with structured detail.

### 2.2 Resolve config (`src/config.ts`)
`resolveConfig(manifest.config, repoRoot)` turns the repo-relative POSIX paths in
the `config` block (`skillsDir`, `adaptersDir`, `targets`, …) into absolute
`ResolvedRoots`. Because every path is sourced here, the emitter is **path-agnostic**
and reusable in another repo by changing only `config` (`REQ-REUSE-01`). All file
writes later go through a **confined writer** that refuses paths escaping the
resolved roots (`PathEscapeError`, `REQ-SEC-01`).

### 2.3 Discover canonical sources (`src/discover.ts`)
`discover()` parses each manifest tool into a typed record — `SkillRecord`,
`AgentRecord`, or `CommandRecord` — splitting frontmatter from body via
`src/frontmatter.ts`. It also collects the shared `references/` and `scripts/` trees
and each skill's owned refs. Records are returned in a **deterministic order**
(sorted by source path), which is what makes the downstream emit order stable.

Frontmatter parsing preserves **insertion order** (frontmatter is a
`Map<string, unknown>`, not a plain object) — essential for byte-stable
re-serialization. Malformed frontmatter throws `MalformedFrontmatterError` carrying
the offending `sourcePath`.

### 2.4 Emit (`src/emit.ts`)
The in-memory heart of the build. For each target in the fixed `TARGET_ORDER`:

1. Look up its `TargetTransform` in the registry (`src/targets/index.ts`).
2. Run `transformSkill` / `transformAgent` / `transformCommand` over every record.
3. Collect every `EmittedFile`, `DropRecord`, and `ManifestEntry`.
4. Re-base each target-bundle-relative relpath to **adapter-root-relative**
   (`<target>/<relpath>`) so override overlay and publish address files uniformly.
5. Build `VerbatimRecord`s for skill-owned refs plus the shared trees.
6. After all records, feed the **name-sorted** manifest entries to
   `aggregateManifest` (e.g. gemini's `gemini-extension.json`, codex's
   `openai.yaml`), threading the project `identity`.

`emit()` is **pure and in-memory**: it writes nothing and applies no overrides
(`overridden` is always empty here). It accepts `identity` as a parameter rather
than reading `package.json`, so it never touches disk for identity.

### 2.5 Overlay overrides (`src/overrides.ts`)
`loadOverrides()` reads `overrides/<target>/<relpath>` whole files;
`applyOverrides()` replaces any matching generated file's content with the override
(`REQ-EMIT-04`). Overrides that point at a path no longer emitted are **non-fatal**
`staleOverrides` — surfaced in the report, never an error (tech-spec §7), so deleting
a tool doesn't break the build on a leftover override.

### 2.6 Report (`src/report.ts`)
`buildReportModel()` + `renderReport()` produce `adapters/GENERATION-REPORT.md`: per
target tallies (emitted / fallback / skipped / overridden / verbatim), the full drop
list with reasons (`REQ-EMIT-03`), and any stale overrides (`REQ-OBS-01`).

### 2.7 Plugin manifests (`src/plugin.ts`)
`emitPlugin(meta)` produces `.claude-plugin/plugin.json` + `marketplace.json` so the
canonical side is an installable Claude plugin (`REQ-PKG`). `PluginMeta` is assembled
in the CLI from `package.json` (single source of truth for `name`/`version`, shared
with the gemini aggregate). A missing name/version raises
`EmitterError("…", "PLUGIN_META_INVALID")`.

### 2.8 Publish (`src/publish.ts`)
`publish()` writes the whole `adapters/` subtree **atomically** (stage to a temp dir,
then swap), and copies `VerbatimRecord`s byte-for-byte preserving mode (scripts stay
`0o755`). Plugin manifests live under `.claude-plugin/`, not `adapters/`, so they are
written through the confined writer rooted at `repoRoot`.

## 3. The drift guard (`src/driftguard.ts`)

`driftCheck()` / `assertNoDrift()` re-run `prepare()` in memory and diff against the
committed tree, classifying each difference (`DriftEntry.kind`):

- **`content`** — a committed file's bytes differ from a fresh emit.
- **`orphan`** — a file is committed under `adapters/` but no longer emitted (e.g.
  a tool was removed without rebuilding).
- **`missing`** — a file is emitted but not committed.

Any entry makes `build --check` throw `DriftError` with a remediation message
(`REQ-VALID-02`, `REQ-OBS-02`). This is what lets the committed adapter bundles be
trusted as artifacts: CI proves they equal a fresh build of source + overrides.

## 4. The determinism model (P0: `REQ-EMIT-05/06`)

Byte-stable output is a hard requirement — it's what makes the drift guard meaningful.
The codebase enforces it structurally:

- **No nondeterministic inputs.** There is no `Date.now`, `new Date`, `Math.random`,
  or `crypto.random*` anywhere in non-test `src/`. The only pid-derived value (the
  publish staging-dir name) is never itself published.
- **No timestamp in provenance.** The `PROVENANCE` headers embed a static
  `REGEN_CMD` (`bun run build`), never a build time.
- **Fixed orderings.** `TARGET_ORDER` fixes target iteration; `KEY_ORDER`
  (`orderFrontmatter`) fixes frontmatter key emission; records are pre-sorted by
  source path; manifest entries are pre-sorted by `name` (`byName`) before
  aggregation. No serialized output iterates a `Map`/`Object.keys`/`for..in` whose
  order isn't first pinned.
- **Stable serializers.** YAML uses `YAML_OPTS = { sortKeys: false, lineWidth: 4096 }`
  (no key reordering, no reflow); TOML uses `smol-toml` over pre-ordered keys; JSON
  is built from literal key order.

The `determinism` test suite asserts two consecutive emits are byte-equal and that a
post-publish `driftCheck` is clean, including a TOML-specific case.

## 5. The target-transform contract (`src/targets/_shared.ts`)

Every target implements one interface, so adding a target is a closed, local change:

```ts
interface TargetTransform {
  readonly target: Target;                       // == registry key == a Target literal
  transformSkill(skill: SkillRecord): TransformOutput;
  transformAgent(agent: AgentRecord): TransformOutput;
  transformCommand(command: CommandRecord): TransformOutput;
  aggregateManifest(                             // called ONCE after all records,
    entries: ManifestEntry[],                    // entries pre-sorted by name
    identity: { name: string; version: string },
  ): EmittedFile | null;                         // null = target has no aggregate
}

interface TransformOutput {
  files: EmittedFile[];          // adapters/<target>-relative paths
  drops: DropRecord[];           // every unrepresentable construct — never silently empty
  manifestEntries: ManifestEntry[];
}
```

The registry (`src/targets/index.ts`) is a `Record<Target, TargetTransform>`, so the
type system **statically guarantees** all five targets are implemented. Transforms are
**pure** — no file I/O, no `Date.now`, no RNG — which is what keeps the whole pipeline
deterministic.

Shared helpers in `_shared.ts` keep per-target modules thin and consistent:
`orderFrontmatter` (fixed key order), `renderFrontmatter` (frontmatter + Form-A
provenance), `dropAllClaudeKeys` (agent structural-key drops), `hintValue`
(`argument-hint` extraction), and `skillVerbatimRecords` (place a skill's owned refs
under the right per-target directory).

### Per-target shape (summary)

| Target | Skills | Commands | Agents | Aggregate |
| --- | --- | --- | --- | --- |
| `claude` | `skills/<n>/SKILL.md` (canonical, no drops) | native `commands/` | native `agents/` | — |
| `codex` | `skills/<n>/SKILL.md` | best-effort fallback | TOML agent + structural-key drops | `openai.yaml` |
| `cursor` | flattened `rules/<n>.mdc` | native command | agent → rule | — |
| `gemini` | `skills/<n>/<n>.md` | TOML commands | agent file | `gemini-extension.json` (identity-bearing) |
| `copilot` | `instructions/<n>.instructions.md` | `.prompt.md` / instruction fallback | `.agent.md` | — |

The exact per-target rules live in spec `04-transforms.md`; the code is the source of
truth for current behavior.

## 6. Key design decisions

- **Claude form is canonical (`CON-03`).** Adapters are transforms *of* the Claude
  artifacts, not parallel sources. This avoids an N-way merge problem and gives every
  target a single upstream to diff against.
- **Explicit manifest over filesystem globbing.** `tools.manifest.json` is the one
  discovery input that feeds both the emitter and the drift guard. A tool that isn't
  in the manifest doesn't exist to the build — which is also what makes `orphan`
  drift detectable.
- **Committed, drift-guarded output.** Bundles are committed (reviewable, no consumer
  build step) and a CI guard proves they match source. Determinism is the enabling
  invariant.
- **File-level overrides, clearly distinguishable.** Overrides replace whole files and
  carry no provenance header, so a generated file (with its `GENERATED — DO NOT EDIT`
  header) is always visually distinct from an authored override (resolves `OQ-03` at
  the file level).
- **Single identity source.** `package.json` `name`/`version` feed both the plugin
  manifests and the gemini aggregate, so the project can never disagree with itself
  about its own identity.
