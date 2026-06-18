# 00 — Core Definitions

Shared type system, Zod schemas, error hierarchy, and constants for the
agent-agnostic scaffold emitter. **Every other spec document references definitions
here.** All code is TypeScript targeting Bun (CON-01); types are exported through
`src/index.ts` (see `01-architecture-layout.md`).

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-DISC-01 | Explicit tool manifest enumerating tools | 2.1, 2.2 |
| REQ-DISC-03 | Manifest has a defined, validatable schema | 2.1, 2.2 |
| REQ-REUSE-01 | Config-driven, path-agnostic | 2.3 |
| REQ-EMIT-07 | Emit for all four targets | 2.4 |
| REQ-TOOLS-01..04 | Skills, agents, commands, scripts/references | 2.4, 3 |
| REQ-EMIT-03/03a | Coverage-report entry + warning for fallbacks | 3.4, 4 |
| REQ-VALID-05 / REQ-OBS-01 | Coverage/capability report data | 3.5 |
| REQ-OBS-02 | Drift output identifies which files differ and how | 3.6 |
| REQ-EMIT-06 / REQ-REL-01 | Byte-stable, deterministic constants | 5 |
| REQ-SEC-01 | Path-confinement error | 4 |

## 1. Conventions

- Module is ESM (`"type": "module"`). All types are exported from `src/index.ts`.
- Zod is the single source of truth for any externally-authored data (the
  manifest); `zod-to-json-schema` derives the committed JSON Schema
  (`02-manifest-and-config.md`).
- Naming: `PascalCase` types, `SCREAMING_SNAKE` constants, `camelCase` values.
- Doc comments (`/** … */`) on every exported type and field per the quality bar.

## 2. Manifest & config types (REQ-DISC, REQ-REUSE-01)

These mirror tech-spec §4.1 and are the authoritative definitions.

### 2.1 Enums

```typescript
import { z } from "zod";

/** A canonical tool's kind. Drives which discovery + transform path applies. */
export const ToolType = z.enum(["skill", "agent", "command", "script", "reference"]);
export type ToolType = z.infer<typeof ToolType>;

/** The set of emit targets. `claude` is the canonical/privileged form (CON-03). */
export const Target = z.enum(["claude", "codex", "copilot", "cursor", "gemini"]);
export type Target = z.infer<typeof Target>;
```

### 2.2 Tool entry & manifest (REQ-DISC-01/02/03)

```typescript
/** Per-target mapping flags for a single tool. */
export const TargetToolFlags = z.object({
  /** Skip emitting this tool for this target entirely. Recorded as a skip. */
  exclude: z.boolean().optional(),
});
export type TargetToolFlags = z.infer<typeof TargetToolFlags>;

/** One canonical tool, as enumerated in tools.manifest.json. */
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
export type ToolEntry = z.infer<typeof ToolEntry>;
```

### 2.3 Emitter config block (REQ-REUSE-01)

The config surface is a top-level `config` block in `tools.manifest.json`
(single source of truth). Defaults match the repo-root layout
(`01-architecture-layout.md`); another repo overrides them here. No emitter module
may hardcode a root path or the target list — all are read from `Manifest.config`.

```typescript
/** Path + target configuration. All paths are repo-relative POSIX strings. */
export const EmitterConfig = z.object({
  /** Canonical skill source root. */
  skillsDir: z.string().default("skills"),
  /** Canonical agent source root. */
  agentsDir: z.string().default("agents"),
  /** Canonical slash-command source root. */
  commandsDir: z.string().default("commands"),
  /** Shared references root (copied verbatim). */
  referencesDir: z.string().default("references"),
  /** Shared scripts root (copied verbatim, mode preserved). */
  scriptsDir: z.string().default("scripts"),
  /** Author-supplied override tree root. */
  overridesDir: z.string().default("overrides"),
  /** Generated, committed adapter output root. */
  adaptersDir: z.string().default("adapters"),
  /** Targets to emit, in this order. CON-04 fixes the set for v1. */
  targets: z.array(Target).default(["claude", "codex", "copilot", "cursor", "gemini"]),
});
export type EmitterConfig = z.infer<typeof EmitterConfig>;
```

### 2.4 Manifest root

```typescript
/** The full tools.manifest.json document. */
export const Manifest = z.object({
  /** Schema version; only `1` is supported this release. */
  version: z.literal(1),
  /** Paths + target list (REQ-REUSE-01). Defaults to the repo-root layout. */
  config: EmitterConfig.default({}),
  /** Every canonical tool (REQ-DISC-01). */
  tools: z.array(ToolEntry),
});
export type Manifest = z.infer<typeof Manifest>;
```

## 3. Canonical record types

Discovery (`03-discovery-and-canonical-model.md`) reads each `ToolEntry`'s source
into one of these in-memory records. Transforms
(`04-transforms.md`) consume them.

```typescript
/** Frontmatter + body parsed from a canonical markdown file. */
export interface ParsedDoc {
  /** Ordered frontmatter key/value pairs (insertion order preserved). */
  frontmatter: Map<string, unknown>;
  /** Markdown body after the frontmatter block. */
  body: string;
}

/** A canonical skill (skills/<name>/SKILL.md plus owned refs/scripts). */
export interface SkillRecord {
  name: string;
  description: string;
  /** Remaining frontmatter beyond name/description (e.g. metadata, allowed-tools). */
  metadata: Map<string, unknown>;
  body: string;
  /** Skill-owned reference/script files (repo-relative), copied per adapter. */
  ownRefs: string[];
  sourcePath: string;
}

/** A canonical agent/subagent (agents/<name>.md). */
export interface AgentRecord {
  name: string;
  description: string;
  /** Non-name/description frontmatter, insertion order preserved (claude-only keys). */
  claudeKeys: Map<string, unknown>;
  body: string;
  sourcePath: string;
}

/** A canonical slash command (commands/<name>.md). */
export interface CommandRecord {
  name: string;
  description: string;
  /** Claude `argument-hint`, if present. */
  argumentHint?: string;
  body: string;
  sourcePath: string;
}
```

### 3.4 Emit output records

```typescript
/** A single file the emitter will write into an adapter bundle. */
export interface EmittedFile {
  /** adapters/<target>-relative POSIX path. */
  relpath: string;
  content: string;
  /** POSIX file mode; 0o644 for docs, 0o755 for scripts. */
  mode: number;
}

/** A construct that could not be faithfully represented on a target (REQ-EMIT-03). */
export interface DropRecord {
  target: Target;
  /** Canonical source path the construct came from. */
  source: string;
  /** What was dropped or downgraded (e.g. "agent.model", "command:codex"). */
  construct: string;
  /** Classification driving the coverage report. */
  kind: "fallback" | "skipped";
  /** Human-readable reason (REQ-EMIT-03a). */
  reason: string;
}

/** A file copied byte-identical with no provenance header (REQ-EMIT-06). */
export interface VerbatimRecord {
  relpath: string;
  sourcePath: string;
}

/** Aggregate manifest entry (codex openai.yaml / gemini gemini-extension.json). */
export interface ManifestEntry {
  name: string;
  description: string;
  /** Target-specific extra fields, if any. */
  extra?: Record<string, unknown>;
}

/** Result of transforming all tools for ALL targets. */
export interface EmitResult {
  files: EmittedFile[];
  drops: DropRecord[];
  manifestEntries: ManifestEntry[];
  /** Adapter-relative paths overlaid from overrides/ (REQ-EMIT-04). */
  overridden: string[];
  verbatim: VerbatimRecord[];
}
```

### 3.5 Report model (REQ-VALID-05, REQ-OBS-01)

What `adapters/GENERATION-REPORT.md` renders. Surfaces exactly REQ-OBS-01's
required data: targets emitted, tools processed, fallbacks applied, items skipped.

```typescript
/** Per-target tallies for the coverage report. */
export interface TargetCoverage {
  emitted: number;
  fallback: number;
  skipped: number;
  overridden: number;
  verbatim: number;
}

export interface ReportModel {
  /** Every tool the build processed. */
  toolsProcessed: Array<{ name: string; type: ToolType }>;
  /** Per-target coverage tallies, keyed by Target. */
  perTarget: Record<Target, TargetCoverage>;
  /** All drop/fallback records (REQ-EMIT-03). */
  drops: DropRecord[];
  /** Overrides pointing at no-longer-emitted paths (non-fatal; tech-spec §7). */
  staleOverrides: string[];
}
```

### 3.6 Drift entry (REQ-OBS-02)

```typescript
/**
 * One file-level drift result. `kind` structures REQ-OBS-02's "which files
 * differ AND how": content = bytes differ, orphan = committed but not emitted,
 * missing = emitted but not committed.
 */
export interface DriftEntry {
  relpath: string;
  kind: "content" | "orphan" | "missing";
}
```

## 4. Error hierarchy (REQ-SEC-01, REQ-OBS-02)

All errors extend a single base carrying a stable `code`. Mirrors feature-forge's
`CanonError` hierarchy and rauf's `errors.ts` convention.

```typescript
/** Base for every emitter error. `code` is stable and machine-checkable. */
export class EmitterError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** tools.manifest.json failed Zod validation. Carries the formatted issue list. */
export class ManifestValidationError extends EmitterError {
  constructor(message: string, readonly issues: string[]) {
    super(message, "MANIFEST_INVALID");
  }
}

/** A canonical file has unparseable or schema-invalid frontmatter. */
export class MalformedFrontmatterError extends EmitterError {
  constructor(message: string, readonly sourcePath: string) {
    super(message, "FRONTMATTER_MALFORMED");
  }
}

/** A manifest entry's `source` path does not exist on disk. */
export class SourceNotFoundError extends EmitterError {
  constructor(message: string, readonly sourcePath: string) {
    super(message, "SOURCE_NOT_FOUND");
  }
}

/** A source/override path resolves outside the allowed roots (REQ-SEC-01). Fatal. */
export class PathEscapeError extends EmitterError {
  constructor(message: string, readonly attemptedPath: string) {
    super(message, "PATH_ESCAPE");
  }
}

/** `build --check` found drift. Carries typed per-file entries (REQ-OBS-02). */
export class DriftError extends EmitterError {
  constructor(message: string, readonly entries: DriftEntry[]) {
    super(message, "DRIFT_DETECTED");
  }
}
```

**Note — stale overrides are NOT an error.** A stale override (one targeting a path
the emitter no longer emits) is a non-fatal warning surfaced via
`ReportModel.staleOverrides`, never a thrown error (tech-spec §3.4/§7). There is
deliberately no `OverrideConflictError`.

## 5. Constants (REQ-EMIT-06, REQ-REL-01)

Determinism backbone. All emission MUST use these — no `Date.now()`, no
unordered map iteration.

```typescript
/** Fixed frontmatter key emission order (determinism, REQ-EMIT-06). */
export const KEY_ORDER = [
  "name",
  "description",
  "argument-hint",
  "globs",
  "alwaysApply",
  "tools",
  "model",
  "maxTurns",
  "effort",
  "memory",
  "skills",
] as const;

/** Fixed target emission order (matches EmitterConfig.targets default). */
export const TARGET_ORDER: Target[] = ["claude", "codex", "copilot", "cursor", "gemini"];

/** Regenerate command embedded in provenance headers. */
export const REGEN_CMD = "bun run build";

/** Provenance header templates (see 04-transforms.md §provenance for forms A/B/C). */
export const PROVENANCE = {
  /** Form A: first line inside a YAML frontmatter block. */
  yamlComment: (source: string) =>
    `# GENERATED — DO NOT EDIT. Source: ${source}. Regenerate: ${REGEN_CMD}`,
  /** Form B: HTML comment atop a frontmatter-less markdown file. */
  htmlComment: () => `<!-- GENERATED — DO NOT EDIT. Regenerate: ${REGEN_CMD} -->`,
} as const;

/** YAML serialization options for byte-stable output. */
export const YAML_OPTS = { sortKeys: false, lineWidth: 4096 } as const;
```

## Dependencies

None (this is the foundation document). Depends only on the external `zod`
package.

## Verification

- [ ] `Manifest.parse()` accepts a valid `tools.manifest.json` and rejects one
      missing `version`/`tools`, surfacing `ManifestValidationError`.
- [ ] Every exported type is re-exported from `src/index.ts`.
- [ ] `KEY_ORDER` and `TARGET_ORDER` are the only sources of ordering used by
      transforms (grep: no other literal target arrays in `src/`).
- [ ] Error classes set a stable `code` and `name` equal to the class name.
