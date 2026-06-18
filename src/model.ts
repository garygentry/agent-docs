import { z } from "zod";

/**
 * Core model: shared type system, Zod schemas, and determinism constants for the
 * agent-agnostic scaffold emitter. Every other module imports from here; this is
 * the single source of truth for the manifest schema and ordering literals
 * (00-core-definitions.md).
 */

// ---------------------------------------------------------------------------
// 1. Enums (00 §2.1)
// ---------------------------------------------------------------------------

/** A canonical tool's kind. Drives which discovery + transform path applies. */
export const ToolType = z.enum(["skill", "agent", "command", "script", "reference"]);
/** A canonical tool's kind. Drives which discovery + transform path applies. */
export type ToolType = z.infer<typeof ToolType>;

/** The set of emit targets. `claude` is the canonical/privileged form (CON-03). */
export const Target = z.enum(["claude", "codex", "copilot", "cursor", "gemini"]);
/** The set of emit targets. `claude` is the canonical/privileged form (CON-03). */
export type Target = z.infer<typeof Target>;

// ---------------------------------------------------------------------------
// 2. Tool entry & manifest (00 §2.2)
// ---------------------------------------------------------------------------

/** Per-target mapping flags for a single tool. */
export const TargetToolFlags = z.object({
  /** Skip emitting this tool for this target entirely. Recorded as a skip. */
  exclude: z.boolean().optional(),
});
/** Per-target mapping flags for a single tool. */
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
/** One canonical tool, as enumerated in tools.manifest.json. */
export type ToolEntry = z.infer<typeof ToolEntry>;

// ---------------------------------------------------------------------------
// 3. Emitter config block (00 §2.3, REQ-REUSE-01)
// ---------------------------------------------------------------------------

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
/** Path + target configuration. All paths are repo-relative POSIX strings. */
export type EmitterConfig = z.infer<typeof EmitterConfig>;

/** The full tools.manifest.json document. */
export const Manifest = z.object({
  /** Schema version; only `1` is supported this release. */
  version: z.literal(1),
  /** Paths + target list (REQ-REUSE-01). Defaults to the repo-root layout. */
  config: EmitterConfig.default({}),
  /** Every canonical tool (REQ-DISC-01). */
  tools: z.array(ToolEntry),
});
/** The full tools.manifest.json document. */
export type Manifest = z.infer<typeof Manifest>;

// ---------------------------------------------------------------------------
// 4. Canonical record types (00 §3)
// ---------------------------------------------------------------------------

/** Frontmatter + body parsed from a canonical markdown file. */
export interface ParsedDoc {
  /** Ordered frontmatter key/value pairs (insertion order preserved). */
  frontmatter: Map<string, unknown>;
  /** Markdown body after the frontmatter block. */
  body: string;
}

/** A canonical skill (skills/<name>/SKILL.md plus owned refs/scripts). */
export interface SkillRecord {
  /** kebab-case canonical identifier (== source basename). */
  name: string;
  /** Canonical description; "" when frontmatter omits it. */
  description: string;
  /** Remaining frontmatter beyond name/description (e.g. metadata, allowed-tools). */
  metadata: Map<string, unknown>;
  /** Markdown body after the frontmatter block, byte-preserved. */
  body: string;
  /** Skill-owned reference/script files (repo-relative), copied per adapter. */
  ownRefs: string[];
  /** Repo-relative POSIX path to the canonical source. */
  sourcePath: string;
}

/** A canonical agent/subagent (agents/<name>.md). */
export interface AgentRecord {
  /** kebab-case canonical identifier (== source basename). */
  name: string;
  /** Canonical description; "" when frontmatter omits it. */
  description: string;
  /** Non-name/description frontmatter, insertion order preserved (claude-only keys). */
  claudeKeys: Map<string, unknown>;
  /** Markdown body after the frontmatter block, byte-preserved. */
  body: string;
  /** Repo-relative POSIX path to the canonical source. */
  sourcePath: string;
}

/** A canonical slash command (commands/<name>.md). */
export interface CommandRecord {
  /** kebab-case canonical identifier (== source basename). */
  name: string;
  /** Canonical description; "" when frontmatter omits it. */
  description: string;
  /** Claude `argument-hint`, if present. */
  argumentHint?: string;
  /** Markdown body after the frontmatter block, byte-preserved. */
  body: string;
  /** Repo-relative POSIX path to the canonical source. */
  sourcePath: string;
}

// ---------------------------------------------------------------------------
// 5. Emit output records (00 §3.4)
// ---------------------------------------------------------------------------

/** A single file the emitter will write into an adapter bundle. */
export interface EmittedFile {
  /** adapters/<target>-relative POSIX path. */
  relpath: string;
  /** File contents to write, byte-preserved. */
  content: string;
  /** POSIX file mode; 0o644 for docs, 0o755 for scripts. */
  mode: number;
}

/** A construct that could not be faithfully represented on a target (REQ-EMIT-03). */
export interface DropRecord {
  /** The target the construct was dropped/downgraded for. */
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
  /** adapters/<target>-relative POSIX path the copy is written to. */
  relpath: string;
  /** Repo-relative POSIX path of the canonical source. */
  sourcePath: string;
}

/** Aggregate manifest entry (codex openai.yaml / gemini gemini-extension.json). */
export interface ManifestEntry {
  /** kebab-case canonical identifier (== source basename). */
  name: string;
  /** Canonical description; "" when frontmatter omits it. */
  description: string;
  /** Target-specific extra fields, if any. */
  extra?: Record<string, unknown>;
}

/** Result of transforming all tools for ALL targets. */
export interface EmitResult {
  /** Every generated file, byte-preserved. */
  files: EmittedFile[];
  /** Every dropped/downgraded construct (REQ-EMIT-03). */
  drops: DropRecord[];
  /** Aggregate manifest entries for targets that need one. */
  manifestEntries: ManifestEntry[];
  /** Adapter-relative paths overlaid from overrides/ (REQ-EMIT-04). */
  overridden: string[];
  /** Files copied byte-identical with no provenance header. */
  verbatim: VerbatimRecord[];
}

// ---------------------------------------------------------------------------
// 6. Report model (00 §3.5, REQ-VALID-05, REQ-OBS-01)
// ---------------------------------------------------------------------------

/** Per-target tallies for the coverage report. */
export interface TargetCoverage {
  /** Count of cleanly emitted constructs. */
  emitted: number;
  /** Count of fallback (downgraded) constructs. */
  fallback: number;
  /** Count of skipped constructs. */
  skipped: number;
  /** Count of override-overlaid files. */
  overridden: number;
  /** Count of verbatim-copied files. */
  verbatim: number;
}

/** What `adapters/GENERATION-REPORT.md` renders (REQ-OBS-01). */
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

// ---------------------------------------------------------------------------
// 7. Drift entry (00 §3.6, REQ-OBS-02)
// ---------------------------------------------------------------------------

/**
 * One file-level drift result. `kind` structures REQ-OBS-02's "which files
 * differ AND how": content = bytes differ, orphan = committed but not emitted,
 * missing = emitted but not committed.
 */
export interface DriftEntry {
  /** adaptersDir-relative POSIX path of the drifting file. */
  relpath: string;
  /** How the file differs. */
  kind: "content" | "orphan" | "missing";
}

// ---------------------------------------------------------------------------
// 8. Constants (00 §5, REQ-EMIT-06, REQ-REL-01)
// ---------------------------------------------------------------------------

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
