# 02 — Manifest Loading, Config Resolution & Schema Generation

How the canonical tool manifest (`tools.manifest.json`) is **loaded and validated**,
how its embedded `config` block is **resolved into absolute roots**, how the manifest
JSON Schema (`schemas/tools.manifest.schema.json`) is **generated and drift-guarded**,
and the **manifest↔source cross-check** that confirms each declared tool actually exists
on disk and agrees with its frontmatter.

The manifest is the **single source of truth for which tools exist**, feeding both the
emitter and the drift guard (REQ-DISC-02). This document owns the three modules that turn
the raw JSON file into a validated, path-resolved, cross-checked input the rest of the
pipeline consumes:

- `src/manifest.ts` — `loadManifest()` (read + Zod-validate + cross-check)
- `src/config.ts` — `resolveConfig()` (EmitterConfig → absolute, repo-confined roots)
- `src/schema-gen.ts` — `buildManifestSchemaJson()` + `--check` drift guard

All shared types (`Manifest`, `EmitterConfig`, `ToolEntry`, `Target`, `ToolType`) and all
error classes (`ManifestValidationError`, `SourceNotFoundError`, `MalformedFrontmatterError`,
`PathEscapeError`) are defined in `00-core-definitions.md` and are **referenced, not
redefined**, here.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-DISC-01 | Explicit tool manifest enumerating each tool, type, overrides | 2, 6 |
| REQ-DISC-02 | Manifest is the single source feeding emitter AND drift guard | 2.1, 2.4 |
| REQ-DISC-03 | Manifest has a defined, validatable schema (Zod → JSON Schema, drift-guarded) | 4 |
| REQ-REUSE-01 | Every path read from config; nothing hardcoded | 3 |
| REQ-SEC-01 | Configured roots must resolve inside the repo (sanity-check; enforcement in 05) | 3.2 |
| TQ-4 (resolved) | Manifest↔on-disk source cross-check (existence + frontmatter agreement) | 2.3 |

## Dependencies

This document depends on the following being implemented first:

- **`00-core-definitions.md`** — provides `Manifest`, `EmitterConfig`, `ToolEntry`,
  `Target`, `ToolType` (Zod schemas + inferred types), and the error classes
  `ManifestValidationError`, `SourceNotFoundError`, `MalformedFrontmatterError`,
  `PathEscapeError`. **Do not redefine these.**
- **`01-architecture-layout.md`** — fixes the module locations (`src/manifest.ts`,
  `src/config.ts`, `src/schema-gen.ts`), the `schemas/tools.manifest.schema.json` output
  path, and the package scripts (`schema:gen`, `schema:check`, `gate`).

This document is depended ON by:

- **`03-discovery-and-canonical-model.md`** — consumes the validated `Manifest` and the
  resolved `ResolvedConfig` to read each `ToolEntry.source` into a record. The frontmatter
  parser it defines (`src/frontmatter.ts`) is reused here for the cross-check (§2.3); see
  the WARNING in §2.3.
- **`05-overrides-publish-determinism.md`** — owns the actual path-confinement enforcement
  (`src/paths.ts`, `PathEscapeError` on write). This document performs only a read-time
  **sanity-check** of configured roots (§3.2) and defers write confinement there.
- **`07-packaging-and-sample-tool.md` / `08-testing-strategy.md`** — reference the
  concrete example manifest in §6.

## 1. Module responsibilities & flow

```
tools.manifest.json ──read──▶ loadManifest()                 [src/manifest.ts]
                              │
                              ├─ JSON.parse           → SyntaxError → ManifestValidationError
                              ├─ Manifest.safeParse   → ManifestValidationError (formatted issues)
                              ├─ resolveConfig()      → ResolvedConfig          [src/config.ts]
                              │     └─ confine roots inside repo (sanity-check)
                              └─ crossCheckSources()  → SourceNotFoundError | ManifestValidationError
                                                       (TQ-4: existence + frontmatter agreement)
                              ▼
                     { manifest: Manifest, config: ResolvedConfig }
                              ▼
            consumed identically by emit (build) AND driftCheck (build --check)  ⇐ REQ-DISC-02
```

`loadManifest()` is the **only** entry point that turns the on-disk file into a trusted
in-memory value. Both `emit` (`04`/`05`) and `driftCheck` (`06`) call it, so the tool set
can never diverge between emit and check (REQ-DISC-02).

## 2. Manifest loading & validation (`src/manifest.ts`)

### 2.1 `loadManifest`

```typescript
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Manifest } from "./model.js"; // re-exports 00 §2 Zod schema
import { ManifestValidationError } from "./errors.js";
import { resolveConfig, type ResolvedConfig } from "./config.js";
import { crossCheckSources } from "./manifest.js";

/** A fully loaded, validated, path-resolved, cross-checked manifest. */
export interface LoadedManifest {
  /** The Zod-validated manifest (defaults applied for `config`). */
  manifest: Manifest;
  /** EmitterConfig resolved to absolute, repo-confined roots (see config.ts). */
  config: ResolvedConfig;
}

/**
 * Read, parse, validate, and cross-check tools.manifest.json. This is the single
 * source of truth feeding BOTH the emitter and the drift guard (REQ-DISC-02): both
 * call this function so the tool set cannot diverge between emit and check.
 *
 * Steps, in order:
 *   1. Read the file (ENOENT → ManifestValidationError, not a raw fs error).
 *   2. JSON.parse (SyntaxError → ManifestValidationError with the parse message).
 *   3. Manifest.safeParse — on failure throw ManifestValidationError carrying the
 *      formatted Zod issue list (00 §4).
 *   4. resolveConfig — turn config paths into absolute, repo-confined roots (§3).
 *   5. crossCheckSources — confirm each tool's `source` exists and its on-disk
 *      frontmatter `name` agrees with the manifest (§2.3, resolves TQ-4).
 *
 * @param manifestPath - Repo-relative or absolute path to tools.manifest.json.
 * @param repoRoot - Absolute repo root; all config paths resolve relative to it.
 *                   Defaults to the directory containing the manifest file.
 * @returns The validated manifest plus its resolved config.
 * @throws {ManifestValidationError} File missing, unparseable JSON, Zod failure,
 *         or a source/frontmatter cross-check mismatch.
 * @throws {SourceNotFoundError} A tool's `source` path does not exist on disk.
 * @throws {PathEscapeError} A configured root resolves outside the repo (§3.2).
 */
export function loadManifest(
  manifestPath: string,
  repoRoot?: string,
): LoadedManifest;
```

### 2.2 Validation detail

The Zod `Manifest` schema lives in `00-core-definitions.md §2.4`; this module only
**applies** it.

```typescript
/** Format Zod issues into the stable string[] carried by ManifestValidationError. */
function formatIssues(issues: import("zod").ZodIssue[]): string[] {
  // Each issue → `tools[2].type: Invalid enum value. Expected 'skill' | ... got 'skil'`.
  return issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`);
}

const result = Manifest.safeParse(raw);
if (!result.success) {
  throw new ManifestValidationError(
    `tools.manifest.json failed validation (${result.error.issues.length} issue(s))`,
    formatIssues(result.error.issues),
  );
}
const manifest = result.data; // config defaults already applied by Zod
```

**Error handling for every operation in `loadManifest`:**

| Operation | Failure | Handling |
|-----------|---------|----------|
| `readFileSync` | `ENOENT` / unreadable | catch, throw `ManifestValidationError("tools.manifest.json not found at <path>", [])` |
| `JSON.parse` | `SyntaxError` | catch, throw `ManifestValidationError("invalid JSON: <msg>", [])` |
| `Manifest.safeParse` | Zod failure | throw `ManifestValidationError(summary, formatIssues(...))` |
| `resolveConfig` | path escapes repo | propagate `PathEscapeError` (§3.2) |
| `crossCheckSources` | missing source | propagate `SourceNotFoundError` (§2.3) |
| `crossCheckSources` | frontmatter name/type mismatch | propagate `ManifestValidationError` (§2.3) |

No operation is left unhandled; any thrown error exits the CLI non-zero **before** any
adapter file is written (atomic publish, tech-spec §3.6 / `05`).

### 2.3 Manifest↔source cross-check — resolution of TQ-4

Tech-spec **TQ-4** ("should the manifest schema-validate that each `source`'s on-disk
frontmatter agrees with the manifest `type`/`name`, or trust the manifest?") is **resolved
here as: cross-check and error on mismatch** (the tech-spec's stated leaning). This is the
manifest's correctness contract beyond pure Zod shape-validation.

```typescript
/**
 * For each tool in the manifest, verify against the canonical source on disk:
 *   (a) the `source` path EXISTS (else SourceNotFoundError);
 *   (b) for markdown-bearing types (skill/agent/command), the source's frontmatter
 *       `name` (WHERE PRESENT) EQUALS the manifest `name` (else ManifestValidationError);
 *   (c) the on-disk shape matches the declared `type` (a skill source must be a
 *       directory containing SKILL.md; agent/command must be a single .md file).
 *
 * Resolves tech-spec TQ-4: cross-check and error on mismatch rather than trusting
 * the manifest blindly. `script`/`reference` entries are checked for existence only
 * (no frontmatter contract).
 *
 * @param manifest - The Zod-validated manifest.
 * @param config - Resolved absolute roots (used only to resolve `source`).
 * @throws {SourceNotFoundError} A `source` path is absent.
 * @throws {ManifestValidationError} A frontmatter `name`/`type` disagreement, or a
 *         type/shape mismatch (e.g. type:"skill" but source has no SKILL.md).
 * @throws {MalformedFrontmatterError} The source frontmatter is present but unparseable.
 */
export function crossCheckSources(
  manifest: Manifest,
  config: ResolvedConfig,
): void;
```

Resolution rules per `type` (uses `ToolType` from `00 §2.1`):

| `type` | Expected on-disk shape | `name` contract | Existence error |
|--------|------------------------|-----------------|-----------------|
| `skill` | directory `<source>/` containing `SKILL.md` | `SKILL.md` frontmatter `name` (if present) == entry `name` | `SourceNotFoundError` if dir or `SKILL.md` absent |
| `agent` | single file `<source>` (`.md`) | frontmatter `name` (if present) == entry `name` | `SourceNotFoundError` if file absent |
| `command` | single file `<source>` (`.md`) | frontmatter `name` (if present) == entry `name` | `SourceNotFoundError` if file absent |
| `script` | file or directory `<source>` | none (no frontmatter contract) | `SourceNotFoundError` if absent |
| `reference` | file or directory `<source>` | none | `SourceNotFoundError` if absent |

Notes:

- **"Where present":** the canonical Claude frontmatter `name` is optional for some files
  (it can be inferred from the path basename, mirroring feature-forge's identity rule —
  skill name == directory name, agent name == file stem). The cross-check only **enforces
  agreement when the source declares a `name`**; an absent frontmatter `name` is not an
  error here. On mismatch the message names both values, e.g.
  `tools[3].name "graphify": source skills/graphify/SKILL.md frontmatter name is "graphfy" — they must match`.
- **Type/shape mismatch** (e.g. `type: "skill"` but `source` is a lone `.md` with no
  `SKILL.md`) throws `ManifestValidationError` with a message identifying the entry and the
  expected shape from the table above.
- Frontmatter is read via the parser defined in `03-discovery-and-canonical-model.md`
  (`src/frontmatter.ts`). The cross-check needs **only the frontmatter map**, not the body.

> WARNING: As of this writing `src/frontmatter.ts` (the `parseFrontmatter` /
> `splitFrontmatter` export) is specified in `03-discovery-and-canonical-model.md` but
> not yet implemented. `crossCheckSources` MUST import that single parser rather than
> re-implementing frontmatter splitting, to keep the `name` extraction identical to what
> discovery later uses. If `03` names the export differently than `splitFrontmatter`,
> verify the import before implementing. Until `03` lands, the cross-check's
> frontmatter-agreement branch (rule b) cannot be exercised end-to-end.

### 2.4 Single-source guarantee (REQ-DISC-02)

`emit` (`04`/`05`) and `driftCheck` (`06`) **must both** obtain their tool set exclusively
from `loadManifest(...)` — neither may glob the filesystem for tools (this is the explicit
departure from feature-forge, tech-spec §3.3). Verification §V-3 asserts this. Because the
drift guard re-emits from the same loaded manifest, the set of tools cannot drift between
emit and check.

## 3. Config resolution (`src/config.ts`)

`EmitterConfig` (`00 §2.3`) is a set of **repo-relative POSIX path strings** plus the
`targets` list. Resolution turns them into absolute roots that every downstream module
reads — **no module hardcodes a path or the target list** (REQ-REUSE-01).

### 3.1 `ResolvedConfig` & `resolveConfig`

```typescript
import { resolve, isAbsolute, relative, sep } from "node:path";
import type { EmitterConfig, Target } from "./model.js";
import { PathEscapeError } from "./errors.js";

/**
 * EmitterConfig with every directory resolved to an absolute path under repoRoot.
 * Downstream modules (discover, emit, overrides, publish) read ONLY from here —
 * never from constants — so the emitter is path-agnostic and reusable (REQ-REUSE-01).
 */
export interface ResolvedConfig {
  /** Absolute repo root all other roots are confined within. */
  repoRoot: string;
  skillsDir: string;
  agentsDir: string;
  commandsDir: string;
  referencesDir: string;
  scriptsDir: string;
  overridesDir: string;
  adaptersDir: string;
  /** Emit targets in order; CON-04 fixes the v1 set, config makes it overridable. */
  targets: Target[];
}

/**
 * Resolve an EmitterConfig's relative directory strings into absolute roots under
 * repoRoot, sanity-checking that each stays inside the repo (REQ-SEC-01).
 *
 * Every path the emitter uses flows from here (REQ-REUSE-01); this is the ONLY
 * place config strings become absolute. The actual write-time confinement guard
 * (refusing to WRITE outside adapters/) lives in 05-overrides-publish-determinism.md;
 * here we only validate that the configured ROOTS themselves are in-repo.
 *
 * @param config - The validated EmitterConfig (defaults already applied by Zod).
 * @param repoRoot - Absolute repo root.
 * @returns Fully resolved, repo-confined roots + target list.
 * @throws {PathEscapeError} A configured directory resolves outside repoRoot
 *         (e.g. "../escape" or an absolute path pointing elsewhere).
 */
export function resolveConfig(
  config: EmitterConfig,
  repoRoot: string,
): ResolvedConfig;
```

### 3.2 Confinement sanity-check

```typescript
/** Resolve `relDir` under `repoRoot` and assert it stays inside the repo. */
function confineRoot(repoRoot: string, relDir: string, label: string): string {
  const abs = isAbsolute(relDir) ? relDir : resolve(repoRoot, relDir);
  const rel = relative(repoRoot, abs);
  // Outside repo if the relative path climbs out (`..`) or is itself absolute.
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
    if (rel === "") return abs; // the repo root itself is allowed (defensive)
    throw new PathEscapeError(
      `config.${label} resolves outside the repository: ${relDir} → ${abs}`,
      abs,
    );
  }
  return abs;
}
```

Scope boundary (do not over-reach into `05`):

- This check is a **read-time sanity gate** on the seven configured *roots*. It guarantees
  the emitter will not be pointed at, say, `overridesDir: "../../etc"`.
- It does **not** enforce per-file write confinement of individual `source` values or
  override relpaths — that enforcement (resolving every emitted path and refusing writes
  outside the staging/`adapters/` tree, also raising `PathEscapeError`) is owned by
  `05-overrides-publish-determinism.md §paths`. Both reuse the same `PathEscapeError` type
  from `00 §4`.

### 3.3 No hardcoding (REQ-REUSE-01)

`cli.ts`, `emit.ts`, `discover.ts`, `overrides.ts`, and `publish.ts` accept a
`ResolvedConfig` and read every path and the `targets` list from it. The literals in
`00 §5` (`KEY_ORDER`, `TARGET_ORDER`, `PROVENANCE`, `YAML_OPTS`) are determinism/format
constants, **not** path or target-set configuration, and are exempt. Verification §V-5
greps for stray path/target literals.

## 4. JSON-Schema generation & drift guard (`src/schema-gen.ts`)

Mirrors rauf's `scripts/generate-json-schemas.ts --check` pattern (read at
`/home/gary/workspace/rauf/scripts/generate-json-schemas.ts`): a **pure builder** plus a
side-effectful CLI that either writes or, with `--check`, regenerates to a temp value and
diffs against the committed file (exit non-zero on drift). This satisfies REQ-DISC-03 and
is wired into the `gate` script (`01 §3`, `schema:check`).

### 4.1 Pure builder

```typescript
import { zodToJsonSchema } from "zod-to-json-schema";
import { Manifest } from "./model.js";

/** Committed JSON Schema output path (relative to repo root). Single committed copy. */
export const SCHEMA_OUTPUT_PATH = "schemas/tools.manifest.schema.json" as const;

/**
 * Build the manifest JSON Schema string from the Zod `Manifest` source of truth
 * (00 §2.4). Pure: no filesystem, no clock — safe to call from both the writer and
 * the drift check, guaranteeing the two compare identical bytes (REQ-EMIT-06 spirit).
 *
 * Uses `$refStrategy: "none"` so the schema is fully inlined (matches rauf), and
 * appends a trailing newline so the committed file is POSIX-clean and byte-stable.
 *
 * @returns The pretty-printed JSON Schema text (2-space indent, trailing newline).
 */
export function buildManifestSchemaJson(): string {
  const schema = zodToJsonSchema(Manifest, { $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  schema["$schema"] = "http://json-schema.org/draft-07/schema#";
  schema["$id"] = "tools.manifest.schema.json";
  schema["title"] = "Agent-Docs Tool Manifest";
  schema["description"] =
    "Canonical tool registry + emitter config for the agent-agnostic scaffold (REQ-DISC-01/03).";
  return JSON.stringify(schema, null, 2) + "\n";
}
```

### 4.2 CLI: write & `--check`

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dirname, "..");
  const check = process.argv.includes("--check");
  const output = buildManifestSchemaJson();
  const abs = resolve(repoRoot, SCHEMA_OUTPUT_PATH);

  if (check) {
    // Drift guard: regenerate to an in-memory value, diff against the committed file.
    const current = existsSync(abs) ? readFileSync(abs, "utf-8") : "";
    if (current !== output) {
      console.error(
        `Manifest schema drift: ${SCHEMA_OUTPUT_PATH} differs from the Zod source.\n` +
          `Run: bun run schema:gen   (then commit the result)`,
      );
      process.exit(1);
    }
    console.log("Manifest schema is in sync with the Zod source.");
    process.exit(0);
  }

  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, output);
  console.log(`Generated ${SCHEMA_OUTPUT_PATH}`);
}
```

**Error handling:**

- `--check` with a **missing** committed schema → `current = ""` → mismatch → exit 1 with
  the regenerate hint (never throws on absent file).
- Read/write `fs` errors propagate as fatal (non-zero exit); the writer `mkdirSync`s the
  `schemas/` dir first so a fresh clone can generate.
- The builder is pure, so `schema:gen` and `schema:check` compare **byte-identical** output
  — the drift guard is reliable (no formatting nondeterminism).

The `--check` mode is invoked by the `schema:check` package script and is part of `gate`
(`01 §3`); a stale committed schema fails CI exactly as a stale adapter does (CON-05
parallel to REQ-VALID-01).

## 5. Worked usage example

```typescript
import { loadManifest } from "./manifest.js";

// Build / drift-check both start identically (REQ-DISC-02):
const { manifest, config } = loadManifest("tools.manifest.json", process.cwd());

console.log(config.targets);          // ["claude","codex","copilot","cursor","gemini"]
console.log(config.skillsDir);        // /abs/repo/skills
for (const tool of manifest.tools) {  // already cross-checked against disk (§2.3)
  console.log(tool.name, tool.type, tool.source);
}
```

Failure shapes:

```text
$ bun run build           # source missing
SourceNotFoundError [SOURCE_NOT_FOUND]: tools[2].source "skills/missing-skill" does not exist

$ bun run build           # frontmatter disagreement
ManifestValidationError [MANIFEST_INVALID]: tools[0].name "graphify": source
  skills/graphify/SKILL.md frontmatter name is "graphfy" — they must match

$ bun run schema:check    # stale committed schema
Manifest schema drift: schemas/tools.manifest.schema.json differs from the Zod source.
Run: bun run schema:gen   (then commit the result)
```

## 6. Concrete `tools.manifest.json` (referenced by 07/08)

The committed manifest below shows the explicit `config` block (REQ-DISC-01/REQ-REUSE-01)
plus representative tool entries, including the **MVP sample skill** (`graphify`) used as
the end-to-end / golden-snapshot proof (OQ-04; consumed by `07-packaging-and-sample-tool.md`
and `08-testing-strategy.md`). All `config` fields are shown explicitly for clarity;
because each has a Zod default (`00 §2.3`), a minimal manifest may omit `config` entirely
and inherit the repo-root defaults.

```json
{
  "version": 1,
  "config": {
    "skillsDir": "skills",
    "agentsDir": "agents",
    "commandsDir": "commands",
    "referencesDir": "references",
    "scriptsDir": "scripts",
    "overridesDir": "overrides",
    "adaptersDir": "adapters",
    "targets": ["claude", "codex", "copilot", "cursor", "gemini"]
  },
  "tools": [
    {
      "name": "graphify",
      "type": "skill",
      "source": "skills/graphify",
      "description": "Convert any input into a knowledge graph (MVP sample skill).",
      "targets": {
        "gemini": { "exclude": false }
      }
    },
    {
      "name": "spec-author",
      "type": "agent",
      "source": "agents/spec-author.md",
      "description": "Authors a single numbered implementation spec."
    },
    {
      "name": "graphify",
      "type": "command",
      "source": "commands/graphify.md",
      "description": "Slash command that triggers the graphify skill.",
      "targets": {
        "codex": { "exclude": true },
        "copilot": { "exclude": true },
        "gemini": { "exclude": true }
      }
    },
    {
      "name": "spec-examples",
      "type": "reference",
      "source": "references/spec-examples.md"
    }
  ]
}
```

Notes for `07`/`08`:

- The `graphify` **skill** entry is the MVP proof; its golden output lives under
  `src/test/__golden__/<target>/` (`06`/`08`).
- The `graphify` **command** entry demonstrates a tool **excluded** from three targets
  (`codex`/`copilot`/`gemini` have no confirmed native slash-command construct, tech-spec
  §3.5 / TQ-1); those exclusions are recorded as skips in the coverage report (`06`).
- `name` collisions across **different types** (`skill` `graphify` vs `command` `graphify`)
  are permitted — uniqueness is per `(type, name)`, not per `name` (mirrors Claude, where a
  skill and a command may share a slug).
- Every `source` here must satisfy the §2.3 cross-check at load time.

## Verification

- [ ] **V-1** `loadManifest("tools.manifest.json")` on the §6 example returns a `Manifest`
      with `config` defaults applied and four tools, and a `ResolvedConfig` whose
      `skillsDir` is absolute and under `repoRoot`.
- [ ] **V-2** A manifest missing `version`, with an unknown `type`, or with a bad `name`
      (non-kebab) throws `ManifestValidationError` whose `issues[]` names the offending
      `tools[N].field` path.
- [ ] **V-2a** A file that is not valid JSON, and a non-existent manifest path, both throw
      `ManifestValidationError` (not a raw `SyntaxError`/`ENOENT`).
- [ ] **V-3 (REQ-DISC-02)** Both `emit` and `driftCheck` obtain tools only via
      `loadManifest`; grep confirms no filesystem-glob of tools outside `manifest.ts`.
- [ ] **V-4 (TQ-4)** A `ToolEntry` whose `source` is absent throws `SourceNotFoundError`;
      a skill whose `SKILL.md` frontmatter `name` disagrees with the entry `name` throws
      `ManifestValidationError`; a `type:"skill"` entry pointing at a lone `.md` (no
      `SKILL.md`) throws `ManifestValidationError`.
- [ ] **V-4a** A `script`/`reference` entry with no frontmatter passes the cross-check on
      existence alone.
- [ ] **V-5 (REQ-REUSE-01)** Setting `config.skillsDir` to a custom value redirects
      discovery there; no path/target literal exists outside `config.ts` (and the `00 §5`
      determinism constants).
- [ ] **V-6 (REQ-SEC-01)** `config.overridesDir: "../escape"` throws `PathEscapeError`
      during `resolveConfig`.
- [ ] **V-7 (REQ-DISC-03)** `bun run schema:gen` writes `schemas/tools.manifest.schema.json`;
      `bun run schema:check` exits 0 on a fresh generate and exits non-zero after the
      committed schema is hand-edited or deleted.
- [ ] **V-8** `buildManifestSchemaJson()` is pure (no fs/clock) and returns byte-identical
      output across calls, so `schema:gen` and `schema:check` compare equal bytes.
