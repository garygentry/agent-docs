# Progress Log

## 003 — manifest loading + TQ-4 cross-check

- `src/manifest.ts` exports `loadManifest(manifestPath, repoRoot?)` returning a
  validated `Manifest` (per the backlog item's stated signature), plus
  `crossCheckSources`. The spec 02 §2.1 sketches a richer `LoadedManifest`
  {manifest, config} shape, but config.ts (004) and frontmatter.ts (006) are not
  built yet, so this item keeps the simpler return type. When 020 wires the CLI it
  can wrap/extend.
- Cross-check resolves `source` relative to `repoRoot` (defaults to the manifest's
  dir). Frontmatter `name` agreement uses a minimal inline reader (top-level
  `name:` in a `---` fence). **When item 006 lands**, switch the name extraction to
  the shared `src/frontmatter.ts` parser to keep it identical to discovery
  (see 02 §2.3 WARNING).
- ManifestValidationError is thrown (not raw SyntaxError/ENOENT) for missing file
  and bad JSON, per the 02 §2.2 error table.

## 004 — config resolution + path confinement

- `src/config.ts` exports `resolveConfig(config, repoRoot): ResolvedRoots` and the
  `ResolvedRoots` type. Per the item note, ResolvedRoots matches the **05 §7.1**
  shape exactly: repoRoot + the 7 dirs, and deliberately **NO `targets` field**
  (spec 02 §3.1's `ResolvedConfig` includes targets; we did not use that name).
  Downstream (007/013/015/016) read `targets` from `manifest.config.targets`.
- `resolveConfig` normalizes `repoRoot` via `path.resolve` and confines each root
  with the 02 §3.2 `confineRoot` gate (PathEscapeError on `..`/absolute-outside).
- `src/paths.ts` exports `confinePath(root, candidate)` (spec 05 §7 name, used by
  loadOverrides/publish 014/015) and `resolveWithin` as an **alias** of it (the
  item-spec name). Both are the same function — callers may use either.

## 005 — JSON-Schema generation + --check drift guard

- `src/schema-gen.ts` exports `buildManifestSchema()` (returns the JSON Schema
  **object**, the item-spec name) AND `buildManifestSchemaJson()` (the byte-stable
  pretty-printed **string** with trailing newline, the 02 §4 name) — the latter wraps
  the former. Item 024's schema-gen drift test can use either. Also exports
  `SCHEMA_OUTPUT_PATH = "schemas/tools.manifest.schema.json"`.
- The CLI (`import.meta.main`) resolves `repoRoot` from `import.meta.dirname/..`, so its
  output path is FIXED (not config-driven) per the item note — schemas/ is a build path.
- `--check` test spawns `bun run src/schema-gen.ts` via `execFileSync` (vitest runs on
  node, so `import.meta.main` won't fire in-process). The test snapshots any existing
  committed schema and restores/removes it in `afterAll` so it leaves the tree clean.
  The committed `schemas/tools.manifest.schema.json` is written/committed by item 021,
  not this item — a fresh tree has no file and the test cleans up after itself.

## 008 — transform foundation, _shared, registry, claude target

- `src/targets/_shared.ts` exports the `TargetTransform`/`TransformOutput`
  interfaces (04 §3) AND the shared helpers (hintValue, orderFrontmatter,
  renderFrontmatter, dropAllClaudeKeys) + `skillVerbatimRecords(skill, target)`
  for ownRefs→VerbatimRecord (04 §4.6; cursor=rules/<n>/, copilot=instructions/<n>/,
  others=skills/<n>/). The interface lives in `_shared.ts` (not index.ts) because
  every target module imports it without a cycle; index.ts re-exports it.
- TQ-3 confirmed: discover.ts captures the author's single `metadata:` mapping
  verbatim, so `skill.metadata.get("metadata")` IS the nested Map — spec 04's
  hintValue works as written. No flat-vs-nested mismatch.
- `renderFrontmatter` splices PROVENANCE.yamlComment after the opening `---\n`
  (serializeFrontmatter returns `---\n<yaml>---\n<body>`); does NOT pre-order —
  callers must orderFrontmatter first.
- **Registry needs all 5 keys to satisfy `Record<Target, TargetTransform>`**, but
  codex/copilot/cursor/gemini are owned by items 009-012. Created THROWING
  placeholder stubs for those four so index.ts compiles now; items 009-012 OVERWRITE
  them with real logic. Stubs throw (loud), never silent-empty. claude.ts is the
  only real transform in this item.

## 009 — codex target (TOML agents + openai.yaml aggregate)

- `src/targets/codex.ts` replaces the 008 throwing stub. `renderCodexAgentToml` is
  exported (for tests/reuse). Strategy for byte-stable TOML: serialize the scalar
  header keys (`name`, `description`) via `smol-toml` `stringify` in a fixed object
  order, then append `developer_instructions` as a TOML **triple-quoted literal**
  (`'''\n<body>'''`) — smol-toml would otherwise escape `\n` into a single-line
  basic string (confirmed). Leading newline after `'''` is trimmed by TOML, matching
  the 04 §7.6 example. Guard: if the body contains the `'''` delimiter, fall back to
  `smol-toml`-serialized basic string for that key (literal strings can't contain it).
- TQ-2: `CODEX_AGENT_KEYS` empty → every claudeKey drops as `fallback`. Agent also
  contributes one `ManifestEntry`.
- `openai.yaml` aggregate: plain literal `doc` with `_generated` first, serialized
  via `yaml` `stringify(doc, YAML_OPTS)` (sortKeys:false preserves Form C order).

## 011 — gemini target (TOML commands + gemini-extension.json)

- `src/targets/gemini.ts` replaces the 008 throwing stub. `renderGeminiCommandToml`
  is exported (tests/reuse). Mirrors codex's TOML strategy: scalar `description` via
  `smol-toml` `stringify`, then `prompt` as a TOML triple-quoted literal
  (`'''\n<prompt>'''`), with a fallback to a `smol-toml` basic string when the prompt
  contains the `'''` delimiter. Provenance is the leading `# GENERATED …` TOML comment.
- `transformCommand`: argument-hint has no native Gemini field → appended to the
  prompt as `\n\nArguments: <hint>` prose AND drop-recorded (fallback). NOTE: the
  canonical body already ends in `\n`, so body+`\n\n` = three newlines before
  `Arguments:` — adjust golden/test expectations accordingly.
- `':' subdir namespacing` is OUT of scope (V-021): commands emit flat at
  `commands/<name>.toml`; no nested a:b mapping.
- `aggregateManifest(entries, identity)`: identity `{name, version}` is threaded
  from PluginMeta (07 §3.2), NOT hardcoded (V-020). Form C strict JSON via
  `JSON.stringify(doc, null, 2) + "\n"`, `_generated` first, then name/version/skills.
  Skills (not agents/commands) contribute aggregate entries.

## 013 — emit orchestration (src/emit.ts)

- `emit(manifest, roots, identity?)` runs `discover()` then iterates `TARGET_ORDER`,
  looking up each `TargetTransform` in `TRANSFORMS` (src/targets/index.ts). Pure,
  in-memory, `overridden` always `[]` (overlay is item 014, publish 015).
- **Relpath rebasing is the key contract**: transforms return *target-bundle-relative*
  relpaths (e.g. `skills/x/SKILL.md`); emit prefixes `<target>/` to make them
  *adapter-root-relative* (05 §2) for every EmittedFile, VerbatimRecord, and the
  aggregate. Override overlay/publish address files by this `<target>/<relpath>` key.
- **Identity**: signature in the item is `emit(manifest, roots)`, but gemini's
  `aggregateManifest` needs `{name,version}`. Added an optional 3rd `identity` param
  (default stub `agent-docs-scaffold/0.0.0`); item 020 CLI threads the real PluginMeta
  (019) identity through. Not read from disk (keeps emit pure).
- **Verbatim assembly** (engine-owned per 04 §4.6): per target, skill ownRefs via
  `skillVerbatimRecords(skill, target)` PLUS shared refs+scripts (discovery.sharedRefs/
  sharedScripts) copied flat under each adapter at their repo-relative subpath.
- Aggregate entries are collected per-target then `.sort(byName)` before
  `aggregateManifest` (REQ-EMIT-06). EmitResult.manifestEntries accumulates the sorted
  per-target entries (no target discriminator on ManifestEntry — duplicates across
  codex/gemini are expected).
- Did NOT touch src/index.ts barrel — item 020 owns re-exporting emit/driftCheck/etc.

## 014 — override loading + file-level overlay (src/overrides.ts)

- Followed the **spec 05 §3.1** signature `loadOverrides(roots, targets)` (not the
  item's looser `loadOverrides(overridesDir)`) — it confines reads to
  `roots.overridesDir` via `confinePath` and skips targets not in the list. Returns
  `OverrideSet { byAdapterPath: Map<"<target>/<relpath>", OverrideFile> }`.
- `applyOverrides(files, overrides)` is the 05 §3.2 reference sketch verbatim:
  whole-file replace (content+mode), `overridden[]` for hits, `staleOverrides[]` for
  override paths with no emitted counterpart (non-fatal, never throws). Returns a NEW
  array (input not mutated); files/overridden/staleOverrides all stable-POSIX-sorted.
- Modes are read from disk (`mode & 0o777`). **Test gotcha**: a freshly written file
  picks up the umask (0o664), not 0o644 — chmod explicitly in tests if asserting mode.
- Missing overridesDir or per-target subdir → empty overlay (statSync in try/catch),
  not an error (overrides optional, REQ-EMIT-05).

## 016 — drift guard (src/driftguard.ts)

- `driftCheck(manifest, roots, pluginFiles?, identity?)` re-emits in memory
  (`emit` + `loadOverrides`/`applyOverrides`, no publish) and diffs against the
  committed tree. Returns `DriftEntry[]` (content/orphan/missing), POSIX-sorted.
  Also exports `assertNoDrift` (throws `DriftError` w/ `renderDriftMessage`) and
  `renderDriftMessage`.
- **Emitted side must include verbatim files**: publish writes both
  `EmitResult.files` AND `verbatim` records to disk, so the emitted map reads each
  verbatim file's source bytes (`readFileSync(confinePath(repoRoot, sourcePath))`)
  under its `<target>/<relpath>` key — else every committed verbatim copy would
  read as an `orphan`.
- **`.claude-plugin/` is a second guarded root** (06 §2.2): committed side walks
  `adaptersDir` (keyed adaptersDir-relative) AND `repoRoot/.claude-plugin/` (keyed
  `.claude-plugin/...`); key spaces don't collide. Emitted plugin files come from
  item 019 (`emitPlugin`), NOT a dependency of 016 and not yet built — so they are
  threaded in via the optional `pluginFiles` param (default `[]`). Item 020's CLI
  passes the real plugin files; without them a committed `.claude-plugin/*` reads
  as orphan (proven in test). Signature stays `(manifest, roots)`-compatible.
- `walkRelposix` returns adaptersDir-relative POSIX paths and treats a missing dir
  as `[]` (never-built tree = nothing committed, not an error). Staging dirs
  (`adaptersDir.tmp-*`) are siblings of adaptersDir, so they're never walked.

## 022 — cross-cutting determinism / drift / override suites

- Shared fixtures live at `src/test/__fixtures__/index.ts`: `makeFixtureRepo`
  (returns `{ root, roots: ResolvedRoots, manifestPath, manifest }`),
  `cleanupFixtureRepo`, `buildAndPublish`, plus `skillDoc/agentDoc/commandDoc`.
- **API drift from spec 08 §3 sketch** (bound to the real implementation):
  - `resolveConfig(config, repoRoot)` — NOT `resolveRoots` (spec name).
  - `publish(files, verbatim, roots)` — 3 args; `buildAndPublish` passes
    `result.verbatim` and the full `roots` (not `roots.adaptersDir`).
  - skill `source` is the skill **dir** (`skills/<name>`), matching item 021's
    cross-check; discover also accepts the SKILL.md form. The skill dir basename
    MUST equal the tool name (discover enforces name==dirname).
- `src/test/determinism.test.ts` — two-emit byte equality (incl. a TOML construct:
  agent→codex `.toml`, command→gemini `.toml`) + publish idempotency via
  buildAndPublish×2 then driftCheck === [].
- `src/test/driftguard.test.ts` — clean/content/orphan/revert; orphan relpath
  derived from the removed tool name (`d.relpath.includes("doomed")`), not hardcoded.
- Override cross-cutting cases appended to `src/overrides.test.ts` (kept the 014
  unit suite); `OVERRIDE_REL = "cursor/rules/sample.mdc"` (cursor flattens skills).
