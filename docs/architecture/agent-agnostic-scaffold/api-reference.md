# API Reference

The emitter is primarily driven through the `bun run build` CLI, but its core is a
small **programmatic API** exported from the package barrel (`src/index.ts`) so it
can be reused from another repo (`REQ-REUSE-01`). This reference documents that
public surface, the core types, the manifest config block, and the error hierarchy.

> Signatures below are taken from the implementation (`src/`). The CLI commands
> (`build`, `build --check`) are documented in the [root README](../../../README.md);
> the functions here are what those commands compose.

## Public barrel (`src/index.ts`)

```ts
export * from "./errors.js"; // error hierarchy
export * from "./model.js"; // types + Zod schemas + constants
export { loadManifest } from "./manifest.js";
export { emit } from "./emit.js";
export { driftCheck } from "./driftguard.js";
export { validateTargetManifest } from "./validate-manifests.js";
export { emitPlugin } from "./plugin.js";
export type { PluginMeta } from "./plugin.js";
```

### `loadManifest(manifestPath, repoRoot?) → Manifest`

Parse and Zod-validate `tools.manifest.json`, then run the manifest↔source
cross-check (every `source` exists; every skill's `SKILL.md` `name` matches its
manifest `name`). Throws `ManifestValidationError` or `SourceNotFoundError`.

```ts
import { loadManifest } from "agent-docs";
const manifest = loadManifest("/repo/tools.manifest.json", "/repo");
```

### `emit(manifest, roots, identity?) → EmitResult`

The pure, in-memory transform core. Runs every `TargetTransform` over every
discovered record and aggregates the result. Writes nothing to disk and applies no
overrides (`overridden` is always empty). `identity` (`{ name, version }`) is only
consumed by the gemini aggregate; it defaults to a stub when omitted, but the CLI
always threads the real `PluginMeta` identity.

```ts
import { emit } from "agent-docs";
import { resolveConfig } from "agent-docs/config"; // internal helper
const result = emit(manifest, roots, { name: "my-tools", version: "1.2.0" });
// result.files / result.drops / result.manifestEntries / result.verbatim
```

### `driftCheck(manifest, roots, pluginFiles?, identity?) → DriftEntry[]`

Re-emit in memory (with the identical override overlay) and diff against the
committed `adapters/` tree plus the `.claude-plugin/` manifests. Returns one
`DriftEntry` per differing file (`content` / `orphan` / `missing`); an empty array
means no drift. `assertNoDrift(...)` is the throwing wrapper used by `build --check`
— it raises `DriftError` (carrying the remediation message) when the array is
non-empty.

### `validateTargetManifest(target, files) → void`

Validate a target's emitted **aggregate** manifest against its per-target Zod schema
(codex `openai.yaml`, gemini `gemini-extension.json`). Throws
`ManifestValidationError` on a malformed aggregate. No-op for targets without an
aggregate. (`06 §4`, `REQ-VALID-03`.)

### `emitPlugin(meta) → EmittedFile[]`

Produce the two `.claude-plugin/` manifest files (`plugin.json` + `marketplace.json`)
for the canonical Claude side. Pure — no filesystem access; returns `EmittedFile[]`
for the engine to write. Output is byte-stable (fixed key order, no timestamps). A
non-kebab name or non-SemVer version raises `EmitterError("…", "PLUGIN_META_INVALID")`.

```ts
import { emitPlugin, type PluginMeta } from "agent-docs";
const meta: PluginMeta = {
  name: "my-tools",
  version: "1.2.0",
  description: "…",
  author: "me",
  keywords: [],
};
const files = emitPlugin(meta); // → [.claude-plugin/plugin.json, .claude-plugin/marketplace.json]
```

## Core types (`src/model.ts`)

### Enums

- **`ToolType`** = `"skill" | "agent" | "command" | "script" | "reference"` — drives
  which discovery + transform path applies.
- **`Target`** = `"claude" | "codex" | "copilot" | "cursor" | "gemini"` — `claude`
  is the canonical/privileged form (`CON-03`).

### Manifest schemas (Zod)

- **`Manifest`** — the full `tools.manifest.json`: `{ version: 1, config, tools[] }`.
- **`ToolEntry`** — one tool: `{ name, type, source, description?, targets? }`. `name`
  is kebab-case and MUST equal the source basename.
- **`EmitterConfig`** — the `config` block (see [below](#manifest-config-block)).
- **`TargetToolFlags`** — `{ exclude?: boolean }`, per-target opt-out.

### Canonical record types

- **`ParsedDoc`** — `{ frontmatter: Map, body }` (order-preserving frontmatter).
- **`SkillRecord`** — `{ name, description, metadata: Map, body, ownRefs[], sourcePath }`.
- **`AgentRecord`** — `{ name, description, claudeKeys: Map, body, sourcePath }`.
- **`CommandRecord`** — `{ name, description, argumentHint?, body, sourcePath }`.

### Emit output records

- **`EmittedFile`** — `{ relpath, content, mode }`, a file to write.
- **`DropRecord`** — `{ target, source, construct, kind: "fallback" | "skipped", reason }`.
- **`VerbatimRecord`** — `{ relpath, sourcePath }`, a byte-identical copy (no provenance).
- **`ManifestEntry`** — `{ name, description, extra? }`, an aggregate-manifest row.
- **`EmitResult`** — `{ files[], drops[], manifestEntries[], overridden[], verbatim[] }`.

### Report & drift

- **`TargetCoverage`** — `{ emitted, fallback, skipped, overridden, verbatim }`.
- **`ReportModel`** — what `GENERATION-REPORT.md` renders.
- **`DriftEntry`** — `{ relpath, kind: "content" | "orphan" | "missing" }`.

### Determinism constants

- **`KEY_ORDER`** — fixed frontmatter key emission order.
- **`TARGET_ORDER`** — fixed target iteration order.
- **`REGEN_CMD`** = `"bun run build"` — embedded in provenance headers.
- **`PROVENANCE`** — provenance header templates (Form A yaml comment, Form B html comment).
- **`YAML_OPTS`** = `{ sortKeys: false, lineWidth: 4096 }` — byte-stable YAML options.

## Manifest config block

Every paths-and-targets value is read from `manifest.config`, so the emitter is
reusable in another repo by changing only this block. All paths are repo-relative
POSIX strings; defaults match the repo-root layout.

| Field           | Default                                          | Meaning                                           |
| --------------- | ------------------------------------------------ | ------------------------------------------------- |
| `skillsDir`     | `"skills"`                                       | Canonical skill source root.                      |
| `agentsDir`     | `"agents"`                                       | Canonical agent source root.                      |
| `commandsDir`   | `"commands"`                                     | Canonical slash-command source root.              |
| `referencesDir` | `"references"`                                   | Shared references (copied verbatim).              |
| `scriptsDir`    | `"scripts"`                                      | Shared scripts (copied verbatim, mode preserved). |
| `overridesDir`  | `"overrides"`                                    | Author-supplied override tree root.               |
| `adaptersDir`   | `"adapters"`                                     | Generated, committed adapter output root.         |
| `targets`       | `["claude","codex","copilot","cursor","gemini"]` | Targets to emit, in this order.                   |

The committed JSON Schema (`schemas/tools.manifest.schema.json`) is generated from
this Zod model via `bun run schema:gen` and guarded by `bun run schema:check`.

## Error hierarchy (`src/errors.ts`)

All errors extend `EmitterError`, which sets `name` from the subclass and carries a
stable `code` for programmatic handling. Library functions **throw**; only the CLI
maps errors to exit codes.

| Class                       | `code`                  | Extra fields    | Raised when                                          |
| --------------------------- | ----------------------- | --------------- | ---------------------------------------------------- |
| `EmitterError`              | (varies)                | `code`          | Base; also used directly for `PLUGIN_META_INVALID`.  |
| `ManifestValidationError`   | `MANIFEST_INVALID`      | `issues[]`      | Manifest or aggregate fails Zod validation.          |
| `MalformedFrontmatterError` | `FRONTMATTER_MALFORMED` | `sourcePath`    | A canonical file's frontmatter can't be parsed.      |
| `SourceNotFoundError`       | `SOURCE_NOT_FOUND`      | `sourcePath`    | A manifest `source` doesn't exist on disk.           |
| `PathEscapeError`           | `PATH_ESCAPE`           | `attemptedPath` | A write target escapes the confined roots.           |
| `DriftError`                | `DRIFT_DETECTED`        | `entries[]`     | `build --check` finds committed output ≠ fresh emit. |

> There is intentionally **no** `OverrideConflictError`: overrides are whole-file
> replacements, and a stale override is a non-fatal report entry, not an error.
