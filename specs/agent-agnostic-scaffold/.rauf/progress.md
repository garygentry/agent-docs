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
