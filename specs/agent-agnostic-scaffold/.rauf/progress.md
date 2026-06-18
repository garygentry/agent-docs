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
