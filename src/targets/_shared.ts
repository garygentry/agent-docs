import { serializeFrontmatter } from "../frontmatter.js";
import { KEY_ORDER, PROVENANCE } from "../model.js";
import type {
  AgentRecord,
  CommandRecord,
  DropRecord,
  EmittedFile,
  ManifestEntry,
  SkillRecord,
  Target,
  VerbatimRecord,
} from "../model.js";

/**
 * Shared transform helpers (04 §4). Pure functions — NO file I/O, NO Date.now,
 * NO RNG (determinism, REQ-EMIT-06). The per-target modules under `src/targets/`
 * compose these into their {@link TargetTransform} implementations.
 */

// ---------------------------------------------------------------------------
// TransformOutput / TargetTransform interface (04 §3)
// ---------------------------------------------------------------------------

/** The product of transforming ONE canonical record for ONE target (04 §3). */
export interface TransformOutput {
  /** Adapter-relative files this record produces (relative to adapters/<target>/). */
  files: EmittedFile[];
  /** Every unrepresentable construct (REQ-EMIT-03). Never silently empty when a drop occurred. */
  drops: DropRecord[];
  /**
   * Aggregate-manifest entries contributed by this record (codex openai.yaml,
   * gemini gemini-extension.json). Empty for targets with no aggregate.
   */
  manifestEntries: ManifestEntry[];
}

/**
 * One target's complete mapping rule set (REQ-EMIT-02). Pure functions — NO file
 * I/O, NO Date.now, NO RNG (determinism, REQ-EMIT-06). All paths returned in
 * `files[].relpath` are adapters/<target>-relative POSIX strings.
 */
export interface TargetTransform {
  /** Stable target id; MUST equal the registry key and a `Target` literal. */
  readonly target: Target;

  /**
   * Transform a skill (REQ-TOOLS-01). Emits the target's skill/rule/instruction
   * file(s) and drop-records any construct (metadata, argument-hint, allowed-tools)
   * the target cannot represent (REQ-EMIT-03).
   */
  transformSkill(skill: SkillRecord): TransformOutput;

  /**
   * Transform an agent/subagent (REQ-TOOLS-02). Emits the target's agent file and
   * drop-records every non-representable claudeKey (REQ-EMIT-03; TQ-2 for codex).
   */
  transformAgent(agent: AgentRecord): TransformOutput;

  /**
   * Transform a slash command (REQ-TOOLS-03). Emits the target's command/prompt
   * file (or an instruction fallback) and drop-records argument-hint where the
   * target has no structured argument syntax (REQ-EMIT-03; TQ-1).
   */
  transformCommand(command: CommandRecord): TransformOutput;

  /**
   * Build the aggregate-manifest EmittedFile from ALL collected entries, or null
   * for targets with no aggregate. Called ONCE by the engine after every record is
   * transformed, with entries pre-sorted by `name` (determinism, REQ-EMIT-06).
   *
   * `identity` ({ name, version }) is the resolved project identity from
   * `PluginMeta` (07 §3.2). The engine passes it to every target; only gemini
   * (§9.4) consumes it. codex and the no-op targets ignore it.
   */
  aggregateManifest(
    entries: ManifestEntry[],
    identity: { name: string; version: string },
  ): EmittedFile | null;
}

// ---------------------------------------------------------------------------
// 4.1 hintValue — canonical argument-hint extraction
// ---------------------------------------------------------------------------

/**
 * Return the canonical skill `argument-hint` scalar, or undefined if absent.
 * Looks under metadata.metadata['argument-hint'] (the canonical nested shape,
 * 03 §4) and falls back to a top-level metadata['argument-hint']. Ports
 * feature-forge `hint_value` (build-adapters.py:615-623).
 *
 * @param skill - The discovered skill record.
 * @returns The argument-hint string, or undefined.
 */
export function hintValue(skill: SkillRecord): string | undefined {
  const nested = skill.metadata.get("metadata");
  if (nested instanceof Map) {
    const h = nested.get("argument-hint");
    if (typeof h === "string") return h;
  }
  const top = skill.metadata.get("argument-hint");
  return typeof top === "string" ? top : undefined;
}

// ---------------------------------------------------------------------------
// 4.2 orderFrontmatter — fixed key order (REQ-EMIT-06)
// ---------------------------------------------------------------------------

/**
 * Re-order a frontmatter field map into the fixed KEY_ORDER (00 §5), appending any
 * key not in KEY_ORDER afterwards in its original insertion order. Produces a Map
 * whose iteration order is byte-stable across runs (REQ-EMIT-06). Ports
 * feature-forge `order_fields` (build-adapters.py:120+).
 *
 * @param fields - The unordered target frontmatter (insertion order = author order).
 * @returns A new Map ordered by KEY_ORDER, then leftover keys in original order.
 */
export function orderFrontmatter(fields: Map<string, unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const k of KEY_ORDER) {
    if (fields.has(k)) out.set(k, fields.get(k));
  }
  for (const [k, v] of fields) {
    if (!out.has(k)) out.set(k, v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4.3 renderFrontmatter — frontmatter + provenance (Form A)
// ---------------------------------------------------------------------------

/**
 * Render a complete markdown document: a `---`-delimited frontmatter block whose
 * FIRST line is the provenance comment (PROVENANCE.yamlComment, Form A, 00 §5),
 * followed by the ordered fields, then the body. Fields MUST already be ordered by
 * {@link orderFrontmatter}. Byte-stable via YAML_OPTS (no key sort, no reflow).
 *
 * @param fields - Pre-ordered frontmatter Map.
 * @param body - The markdown body (preserved byte-for-byte).
 * @param sourcePath - Canonical source path, embedded in the provenance line.
 * @returns The full document string.
 */
export function renderFrontmatter(
  fields: Map<string, unknown>,
  body: string,
  sourcePath: string,
): string {
  const block = serializeFrontmatter(fields, body);
  // block === "---\n<yaml>---\n<body>"; splice the provenance comment after "---\n"
  // so it is the first line INSIDE the `---` fences, before the first YAML key.
  const head = "---\n";
  return head + PROVENANCE.yamlComment(sourcePath) + "\n" + block.slice(head.length);
}

// ---------------------------------------------------------------------------
// 4.4 dropAllClaudeKeys — agent structural-key drops (REQ-EMIT-03)
// ---------------------------------------------------------------------------

/**
 * Produce one DropRecord per claudeKey that a target cannot represent, EXCEPT keys
 * in `keep`. `kind` is "fallback" because the agent body+description still emit
 * (nearest representable equivalent, REQ-EMIT-03a) — only the structural keys drop.
 *
 * @param agent - The agent whose claudeKeys are being filtered.
 * @param target - Target id for the records.
 * @param reason - Human-readable reason (REQ-EMIT-03a).
 * @param keep - Keys the target DOES represent (default: none → all drop).
 * @returns DropRecords in claudeKeys insertion order (deterministic).
 */
export function dropAllClaudeKeys(
  agent: AgentRecord,
  target: Target,
  reason: string,
  keep: ReadonlySet<string> = new Set(),
): DropRecord[] {
  const drops: DropRecord[] = [];
  for (const k of agent.claudeKeys.keys()) {
    if (keep.has(k)) continue;
    drops.push({
      target,
      source: agent.sourcePath,
      construct: `agent.${k}`,
      kind: "fallback",
      reason,
    });
  }
  return drops;
}

// ---------------------------------------------------------------------------
// 4.6 Skill-owned references / verbatim copies (REQ-EMIT-03)
// ---------------------------------------------------------------------------

/**
 * The adapter-relative directory under which a target places a skill's owned
 * reference subtree (04 §4.6). Each ref's path stays stable across targets at
 * `<skill-location>/<ref-subpath>`:
 *
 * - claude / codex / gemini → `skills/<n>`
 * - copilot                 → `instructions/<n>`
 * - cursor (flattened rule) → `rules/<n>` (sibling dir to `rules/<n>.mdc`)
 */
function skillRefDir(target: Target, name: string): string {
  switch (target) {
    case "cursor":
      return `rules/${name}`;
    case "copilot":
      return `instructions/${name}`;
    default:
      return `skills/${name}`;
  }
}

/**
 * Map a skill's `ownRefs` (00 §3.4 — repo-relative POSIX paths under the skill's
 * canonical directory) to {@link VerbatimRecord}s for a target (04 §4.6). Each
 * ref's subpath is rebased relative to the skill's canonical root (the directory
 * containing SKILL.md), then placed under the per-target skill location. Verbatim
 * copies carry NO provenance header — the engine in 05 performs the byte-identical
 * copy; this only declares the destination relpath.
 *
 * @param skill - The discovered skill record.
 * @param target - The emit target.
 * @returns VerbatimRecords in `ownRefs` order (deterministic).
 */
export function skillVerbatimRecords(skill: SkillRecord, target: Target): VerbatimRecord[] {
  const slash = skill.sourcePath.lastIndexOf("/");
  const skillRoot = slash === -1 ? "" : skill.sourcePath.slice(0, slash); // e.g. skills/<n>
  const prefix = skillRefDir(target, skill.name);
  return skill.ownRefs.map((ref) => {
    const subpath =
      skillRoot.length > 0 && ref.startsWith(`${skillRoot}/`)
        ? ref.slice(skillRoot.length + 1)
        : ref;
    return { relpath: `${prefix}/${subpath}`, sourcePath: ref };
  });
}
