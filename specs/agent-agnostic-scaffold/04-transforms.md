# 04 — Transforms

The **transform half** of the emitter: turning the in-memory canonical records
produced by `03-discovery-and-canonical-model.md` (`SkillRecord`, `AgentRecord`,
`CommandRecord`) into per-target `EmittedFile[]`, `DropRecord[]`, and
`ManifestEntry[]`. This document specifies **one module per target** under
`src/targets/` plus the shared transform helpers, and **fixes the per-target rule
set** (REQ-EMIT-02), grounding every rule in 2026 native-format research that
resolves tech-spec **TQ-1** (command/file formats) and **TQ-2** (Codex agent keys).

Scope boundary:

- This document owns **records → in-memory emit records** (pure functions, no I/O).
- The orchestration that calls these transforms, overlays `overrides/`, copies
  shared trees verbatim, aggregates manifests, and atomically publishes is owned by
  `05-overrides-publish-determinism.md`. The aggregate-manifest **serialization**
  (`agents/openai.yaml`, `gemini-extension.json`, with provenance Form C) is
  likewise written by the engine in `05`; this document defines the
  `aggregateManifest()` contract that produces the `EmittedFile` content, but the
  per-target module only contributes `ManifestEntry`s during per-record transform.

All shared types (`SkillRecord`, `AgentRecord`, `CommandRecord`, `EmittedFile`,
`DropRecord`, `ManifestEntry`, `VerbatimRecord`, `Target`), constants
(`KEY_ORDER`, `TARGET_ORDER`, `PROVENANCE`, `YAML_OPTS`, `REGEN_CMD`), and the
`MalformedFrontmatterError` hierarchy come from `00-core-definitions.md` and are
**referenced, not redefined** here. Frontmatter serialization
(`serializeFrontmatter`) comes from `03-discovery-and-canonical-model.md` §2.3.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-EMIT-02 | Defined per-target transform rule set, one per target | 3, 6, 7, 8, 9, 10 |
| REQ-EMIT-03 | Every unrepresentable construct → DropRecord (fallback/skipped) + warning; no silent drops | 4, 5, 6–10 |
| REQ-EMIT-03a | Nearest representable equivalent (design goal) | 5, 6–10 |
| REQ-EMIT-06 / REQ-REL-01 | Byte-stable: KEY_ORDER frontmatter, TARGET_ORDER emission | 4.2, 4.3, 11 |
| REQ-EMIT-07 | Emit adapters for all four targets + canonical claude | 3, 6–10 |
| REQ-TOOLS-01 | Transform skills | 6–10 (`transformSkill`) |
| REQ-TOOLS-02 | Transform agents/subagents | 6–10 (`transformAgent`) |
| REQ-TOOLS-03 | Transform slash commands | 6–10 (`transformCommand`) |
| REQ-VALID-03 | Emitted aggregate manifests are schema-shaped | 6.4, 9.4, 12 |
| TQ-1 | Native command formats per target | 12 |
| TQ-2 | Codex agent structural keys | 7.3, 12 |

## 1. Dependencies

- `00-core-definitions.md` — all record/emit types, `KEY_ORDER`, `TARGET_ORDER`,
  `PROVENANCE`, `YAML_OPTS`, `REGEN_CMD`, `DropRecord`, `ManifestEntry`,
  `MalformedFrontmatterError`.
- `03-discovery-and-canonical-model.md` — the `SkillRecord`/`AgentRecord`/
  `CommandRecord` inputs, the canonical skill frontmatter shape (TQ-3 resolution:
  extras nested under `metadata`, incl. `argument-hint`, `allowed-tools`), and
  `serializeFrontmatter()`.
- `01-architecture-layout.md` — module placement: `src/targets/index.ts` (registry)
  and `src/targets/{claude,codex,copilot,cursor,gemini}.ts`; and `smol-toml@^1.3.0`
  (committed in §3 `package.json`) — the byte-stable TOML serializer used by
  `codex.ts` (agent `.toml`) and `gemini.ts` (command `.toml`).

Must be implemented **after** `03` (consumes its records) and **before**
`05-overrides-publish-determinism.md` (which calls the registry and serializes
aggregates). `06-validation-and-drift-guard.md` consumes the byte-stable output
this document guarantees.

## 2. Module layout

```
src/targets/
  index.ts        # TargetTransform registry: Record<Target, TargetTransform>
  _shared.ts      # orderFrontmatter, renderFrontmatter, hintValue, dropAllClaudeKeys
  claude.ts       # canonical — NO drops
  codex.ts        # TOML agents, openai.yaml aggregate, prompts (deprecated)
  copilot.ts      # .github/ instructions + .agent.md + .prompt.md
  cursor.ts       # .cursor/ .mdc rules + .md agents + .md commands
  gemini.ts       # .gemini/ skills + agents + TOML commands + gemini-extension.json
```

`src/targets/index.ts` exposes the registry keyed in `TARGET_ORDER`
(`00-core-definitions.md` §5); the engine in `05` iterates it in that order so
emission is byte-stable (REQ-EMIT-06).

```typescript
import type { Target } from "../model.js";
import type { TargetTransform } from "./_shared.js";
import { claudeTransform } from "./claude.js";
import { codexTransform } from "./codex.js";
import { copilotTransform } from "./copilot.js";
import { cursorTransform } from "./cursor.js";
import { geminiTransform } from "./gemini.js";

/**
 * The target registry. Keys MUST be exactly the five Targets; the engine in
 * `05-overrides-publish-determinism.md` iterates in TARGET_ORDER, not in object
 * insertion order, so iteration is deterministic regardless of key order.
 */
export const TRANSFORMS: Record<Target, TargetTransform> = {
  claude: claudeTransform,
  codex: codexTransform,
  copilot: copilotTransform,
  cursor: cursorTransform,
  gemini: geminiTransform,
};
```

## 3. The `TargetTransform` interface (REQ-EMIT-02/07)

Every target implements one `TargetTransform`. The interface is **uniform** so the
engine treats all targets identically (REQ-EMIT-02 — "one mapping specification per
target agent, applied programmatically to every tool").

```typescript
import type {
  SkillRecord,
  AgentRecord,
  CommandRecord,
  EmittedFile,
  DropRecord,
  ManifestEntry,
  Target,
} from "../model.js";

/** The product of transforming ONE canonical record for ONE target. */
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
   * Serialization (provenance Form C / YAML) lives in this method; the engine in
   * `05` only writes the returned EmittedFile.
   *
   * `identity` ({ name, version }) is the resolved project identity from
   * `PluginMeta` (07 §3.2). The engine passes it to every target; only gemini
   * (§9.4) consumes it (extension name/version). codex and the no-op targets
   * ignore it.
   */
  aggregateManifest(
    entries: ManifestEntry[],
    identity: { name: string; version: string },
  ): EmittedFile | null;
}
```

**Default no-op aggregate.** claude, copilot, and cursor have no aggregate manifest;
their `aggregateManifest` returns `null` unconditionally. Only codex (§7.4) and
gemini (§9.4) return a file.

## 4. Shared transform helpers (`src/targets/_shared.ts`)

### 4.1 `hintValue` — canonical argument-hint extraction

Per the TQ-3 resolution (`03` §4), a skill's `argument-hint` lives nested under
`SkillRecord.metadata.metadata['argument-hint']` (or, defensively, a top-level
`metadata['argument-hint']` if an author placed it there). This helper centralizes
the lookup so every target drop-records consistently.

```typescript
import type { SkillRecord } from "../model.js";

/**
 * Return the canonical skill `argument-hint` scalar, or undefined if absent.
 * Looks under metadata.metadata['argument-hint'] (the canonical nested shape,
 * `03` §4) and falls back to a top-level metadata['argument-hint']. Ports
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
```

### 4.2 `orderFrontmatter` — fixed key order (REQ-EMIT-06)

```typescript
import { KEY_ORDER } from "../model.js";

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
```

### 4.3 `renderFrontmatter` — frontmatter + provenance (Form A)

```typescript
import { serializeFrontmatter } from "../frontmatter.js";
import { PROVENANCE } from "../model.js";

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
  const withProvenance = new Map<string, unknown>();
  // Provenance is a synthetic first "key" carried as a YAML comment, not a field.
  // serializeFrontmatter emits the map; we inject the comment line manually.
  for (const [k, v] of fields) withProvenance.set(k, v);
  const block = serializeFrontmatter(withProvenance, body);
  // block === "---\n<yaml>---\n<body>"; splice the provenance comment after "---\n".
  const head = "---\n";
  return head + PROVENANCE.yamlComment(sourcePath) + "\n" + block.slice(head.length);
}
```

WARNING: `serializeFrontmatter` (`03` §2.3) does not itself inject provenance; the
comment is spliced as the first line **inside** the block here (Form A). An
implementer MUST verify the splice keeps the comment inside the `---` fences and
before the first YAML key, matching feature-forge `render_frontmatter_block`
(build-adapters.py:565-583).

### 4.4 `dropAllClaudeKeys` — agent structural-key drops (REQ-EMIT-03)

```typescript
import type { AgentRecord, DropRecord, Target } from "../model.js";

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
```

### 4.5 Drop discipline (REQ-EMIT-03)

Every target follows the same rule: **whenever a representable artifact is still
produced but some construct is lost, emit `kind: "fallback"`; when the whole tool
cannot be emitted for the target, emit `kind: "skipped"`.** No path returns silently
without a record. The engine in `05` turns every `DropRecord` into a stderr warning
and a `GENERATION-REPORT.md` row (`00` §3.5; `06-validation-and-drift-guard.md`).
The `exclude` flag (`00` §2.2 `TargetToolFlags`) is handled by the engine (it skips
calling the transform and records a `kind: "skipped"` drop) — transforms themselves
never see excluded tools.

### 4.6 Skill-owned references / verbatim copies (REQ-EMIT-03)

A `SkillRecord` carries `ownRefs: string[]` (`00` §3.4) — skill-owned
reference/script files (repo-relative POSIX paths, e.g. a skill's `references/`
subtree) that must be copied **byte-identical, with no provenance header**, into
each adapter alongside the skill. These are not transformed; they become
`VerbatimRecord`s (`00` §3.4) carried out of the transform via the existing
`EmitResult.verbatim` channel — the engine in `05` performs the actual copy and the
per-target transform only declares the intended destination relpath.

**Per-target destination relpath.** For every target whose skill lives in its own
directory, the refs land **under that skill directory**, preserving the subtree
relative to the skill root:

| Target | Skill artifact | Verbatim refs destination (adapter-relative) |
|--------|---------------|-----------------------------------------------|
| claude | `skills/<n>/SKILL.md` | `skills/<n>/<ref-subpath>` |
| codex | `skills/<n>/SKILL.md` | `skills/<n>/<ref-subpath>` |
| gemini | `skills/<n>/<n>.md` | `skills/<n>/<ref-subpath>` |
| copilot | `instructions/<n>.instructions.md` (flat) | `instructions/<n>/<ref-subpath>` |
| **cursor** | `rules/<n>.mdc` (**flattened**, no skill dir) | `rules/<n>/<ref-subpath>` |

`<ref-subpath>` is the `ownRefs` entry rebased to its position relative to the
skill's canonical root (e.g. a canonical `skills/foo/references/bar.md` → adapter
`references/bar.md` under the per-target skill location).

**Cursor (flattened) resolution.** The Cursor skill is emitted as a single flat
`rules/<n>.mdc` rule file (§8) — there is **no** `rules/<n>/` skill directory. We
choose to **co-locate the refs subtree under a sibling directory named for the
rule**: `rules/<n>/<ref-subpath>` (i.e. `rules/<n>.mdc` is the rule file and
`rules/<n>/…` is its refs directory). This is collision-free (`<n>.mdc` is a file,
`<n>/` is a directory — distinct entries in `rules/`), keeps a ref's relative path
stable across all targets (always `<skill-location>/<ref-subpath>`), and keeps the
refs discoverable directly beside the rule that owns them. (The alternative — a
single shared `references/` sibling pooling all skills' refs — was rejected because
it loses per-skill ownership and risks cross-skill filename collisions.)

Each such copy is emitted as a `VerbatimRecord { relpath, sourcePath }` (no
provenance header per `00` §3.4 / §5 below). Per-skill transforms surface these
through the engine's `EmitResult.verbatim`; `TransformOutput` (§3) itself does not
add a new field — the verbatim set is assembled by the engine in `05` from each
skill's `ownRefs` using the destination relpath rule above.

## 5. Provenance forms (REQ-EMIT-06)

Recapped from `00` §5 / tech-spec §5.3 so this document is self-contained:

- **Form A** — YAML-frontmatter markdown files (skills, agents, commands, prompts,
  instructions, Cursor agents). First line **inside** the `---` block is
  `PROVENANCE.yamlComment(source)`. Applied by `renderFrontmatter` (§4.3).
- **Form B** — frontmatter-less markdown (e.g. an `AGENTS.md`/instruction fallback
  with no frontmatter). `PROVENANCE.htmlComment()` as an HTML comment on the first
  line.
- **Form C** — strict JSON (`gemini-extension.json`) and YAML aggregates
  (`agents/openai.yaml`) where a leading comment is impossible/undesirable: a
  top-level `_generated: { source, regenerate }` object emitted **first** (§7.4,
  §9.4).
- **TOML files** (codex agents, gemini commands): provenance is a leading `#`
  comment line (TOML comment) before the first key (a TOML-flavored Form A).

Overridden files carry **no** provenance header (they are author content;
`05-overrides-publish-determinism.md`).

## 6. Claude target (`src/targets/claude.ts`) — canonical, NO drops

CLAUDE is the privileged canonical form (CON-03). It reconstructs the Claude-native
shape and **never drops** any construct (REQ-EMIT-07). `adapters/claude/` doubles as
the installable plugin bundle (`07-packaging-and-sample-tool.md`).

### 6.1 Rules table

| Construct | Emitted file | Frontmatter (KEY_ORDER) | Drops |
|-----------|-------------|--------------------------|-------|
| skill | `skills/<n>/SKILL.md` | `name, description, argument-hint?` + full `metadata` (incl. `allowed-tools`) | none |
| agent | `agents/<n>.md` | `name, description` + **all** `claudeKeys` | none |
| command | `commands/<n>.md` | `name, description, argument-hint?` | none |

### 6.2 `transformSkill`

```typescript
export const claudeTransform: TargetTransform = {
  target: "claude",

  transformSkill(skill) {
    const fields = new Map<string, unknown>();
    fields.set("name", skill.name);
    fields.set("description", skill.description);
    const hint = hintValue(skill);
    if (hint !== undefined) fields.set("argument-hint", hint); // top-level reconstruction
    // Retain the full nested metadata mapping (allowed-tools etc.) under "metadata".
    const meta = skill.metadata.get("metadata");
    if (meta !== undefined) fields.set("metadata", meta);
    const ordered = orderFrontmatter(fields);
    const content = renderFrontmatter(ordered, skill.body, skill.sourcePath);
    return {
      files: [{ relpath: `skills/${skill.name}/SKILL.md`, content, mode: 0o644 }],
      drops: [],
      manifestEntries: [],
    };
  },
  // transformAgent, transformCommand: see 6.3, 6.4
  aggregateManifest: () => null,
};
```

WARNING (low-confidence): the canonical skill keeps `metadata` as a nested mapping
(matching `03` §4). feature-forge surfaces `argument-hint` to top-level **and** keeps
the rest in `metadata`. Verify against the chosen sample skill
(`07-packaging-and-sample-tool.md`) that `allowed-tools` belongs under `metadata`
for Claude, not at top-level — Claude's current SKILL.md spec accepts `allowed-tools`
at top level too. If the sample uses a top-level `allowed-tools`, surface it in
`KEY_ORDER` position and adjust this map accordingly.

### 6.3 `transformAgent`

```typescript
  transformAgent(agent) {
    const fields = new Map<string, unknown>();
    fields.set("name", agent.name);
    fields.set("description", agent.description);
    for (const [k, v] of agent.claudeKeys) fields.set(k, v); // ALL keys, no drops
    const ordered = orderFrontmatter(fields);
    const content = renderFrontmatter(ordered, agent.body, agent.sourcePath);
    return {
      files: [{ relpath: `agents/${agent.name}.md`, content, mode: 0o644 }],
      drops: [],
      manifestEntries: [],
    };
  },
```

### 6.4 `transformCommand`

```typescript
  transformCommand(command) {
    const fields = new Map<string, unknown>();
    fields.set("name", command.name);
    fields.set("description", command.description);
    if (command.argumentHint !== undefined) fields.set("argument-hint", command.argumentHint);
    const ordered = orderFrontmatter(fields);
    const content = renderFrontmatter(ordered, command.body, command.sourcePath);
    return {
      files: [{ relpath: `commands/${command.name}.md`, content, mode: 0o644 }],
      drops: [],
      manifestEntries: [],
    };
  },
```

### 6.5 Before/after example

**Canonical** `commands/summarize.md`:

```markdown
---
name: summarize
description: Summarize the current document.
argument-hint: "[path]"
---
Summarize the document at the given path...
```

**Emitted** `adapters/claude/commands/summarize.md`:

```markdown
---
# GENERATED — DO NOT EDIT. Source: commands/summarize.md. Regenerate: bun run build
name: summarize
description: Summarize the current document.
argument-hint: "[path]"
---
Summarize the document at the given path...
```

DropRecords: **none** (canonical).

## 7. Codex target (`src/targets/codex.ts`)

2026 research (supersedes feature-forge where they differ): Codex skills are a
directory with `SKILL.md` (`{name, description}` frontmatter); Codex **agents are
TOML, not markdown** (`.codex/agents/<name>.toml`); Codex slash commands are
`prompts/<name>.md` (YAML frontmatter) but **OpenAI has DEPRECATED prompts in favor
of skills** — we still emit but warn.

### 7.1 Rules table

| Construct | Emitted file | Format | Frontmatter / fields | Drops |
|-----------|-------------|--------|----------------------|-------|
| skill | `skills/<n>/SKILL.md` | md+YAML | `{name, description}` | `metadata` (incl. `argument-hint`, `allowed-tools`) → fallback |
| agent | `agents/<n>.toml` | TOML | `name, description, developer_instructions` (body→instructions) | every `claudeKey` (`tools`, `model`, …) → fallback (TQ-2) |
| command | `prompts/<n>.md` | md+YAML | `{description, argument-hint}` | DEPRECATION warning; argument-hint kept (Codex supports `$1`-`$9`/`$ARGUMENTS`) |
| aggregate | `agents/openai.yaml` | YAML | `{_generated, agents: [{name, description}]}` | — |

### 7.2 `transformSkill`

```typescript
export const codexTransform: TargetTransform = {
  target: "codex",

  transformSkill(skill) {
    const fields = orderFrontmatter(
      new Map<string, unknown>([["name", skill.name], ["description", skill.description]]),
    );
    const content = renderFrontmatter(fields, skill.body, skill.sourcePath);
    const drops: DropRecord[] = [];
    if (skill.metadata.size > 0) {
      drops.push({
        target: "codex",
        source: skill.sourcePath,
        construct: "skill.metadata",
        kind: "fallback",
        reason: "Codex skill frontmatter reads only {name, description}; metadata (argument-hint, allowed-tools) dropped",
      });
    }
    return {
      files: [{ relpath: `skills/${skill.name}/SKILL.md`, content, mode: 0o644 }],
      drops,
      manifestEntries: [],
    };
  },
  // ...
};
```

### 7.3 `transformAgent` — TOML, TQ-2 resolution

Codex agents are TOML with required `name`, `description`, `developer_instructions`
(the canonical agent body maps to `developer_instructions`). There is **no `tools`
array** — tool restriction is a config-layer concern, not a per-agent field — so
**every** Claude structural `claudeKey` is dropped with a record (TQ-2 default:
drop-with-record). `model` and `model_reasoning_effort` MAY be representable but are
**low confidence** (see §12); the safe default keeps `_CODEX_AGENT_KEYS` empty.

```typescript
  transformAgent(agent) {
    // TQ-2: representable per-agent keys. Empty = safe default (drop all, record each).
    const CODEX_AGENT_KEYS: ReadonlySet<string> = new Set<string>(); // see §12 WARNING
    const toml = renderCodexAgentToml(agent); // §7.5; provenance = leading "# " comment
    const drops = dropAllClaudeKeys(
      agent,
      "codex",
      "no per-agent representation in .codex/agents/<n>.toml (TQ-2); tool restriction is config-layer",
      CODEX_AGENT_KEYS,
    );
    return {
      files: [{ relpath: `agents/${agent.name}.toml`, content: toml, mode: 0o644 }],
      drops,
      manifestEntries: [{ name: agent.name, description: agent.description }],
    };
  },
```

### 7.4 `transformCommand` + `aggregateManifest`

```typescript
  transformCommand(command) {
    const fm = new Map<string, unknown>();
    fm.set("description", command.description);
    if (command.argumentHint !== undefined) fm.set("argument-hint", command.argumentHint);
    const content = renderFrontmatter(orderFrontmatter(fm), command.body, command.sourcePath);
    // DEPRECATION: emitted but OpenAI steers users to Skills. Record as fallback.
    const drops: DropRecord[] = [{
      target: "codex",
      source: command.sourcePath,
      construct: "command:codex",
      kind: "fallback",
      reason: "Codex prompts are DEPRECATED by OpenAI in favor of Skills; emitted to ~/.codex/prompts form but verify before relying on it",
    }];
    return {
      files: [{ relpath: `prompts/${command.name}.md`, content, mode: 0o644 }],
      drops,
      manifestEntries: [],
    };
  },

  aggregateManifest(entries) {
    if (entries.length === 0) return null;
    // entries arrive pre-sorted by name (engine, 05). Form C: _generated first.
    const doc = {
      _generated: { source: "agents/*", regenerate: REGEN_CMD },
      agents: entries.map((e) => ({ name: e.name, description: e.description })),
    };
    const content = stringifyYaml(doc, YAML_OPTS); // leading _generated key (Form C)
    return { relpath: "agents/openai.yaml", content, mode: 0o644 };
  },
```

`stringifyYaml` is sourced from the `yaml` package (mirroring `03` §2.3's
`serializeFrontmatter` sourcing note): `import { stringify as stringifyYaml } from "yaml";`.
The two-arg call `stringifyYaml(doc, YAML_OPTS)` uses `yaml`'s single-options-arg
`stringify(value, options)` overload (no replacer); `YAML_OPTS` carries
`sortKeys: false`, so the `_generated`-first Form C ordering of the literal `doc`
object is preserved byte-for-byte (REQ-EMIT-06).

### 7.5 `renderCodexAgentToml`

```typescript
/**
 * Render a Codex agent TOML file. Required keys (name, description,
 * developer_instructions) emitted in a FIXED order for byte-stability
 * (REQ-EMIT-06). developer_instructions carries the canonical agent body. A
 * leading `# GENERATED …` TOML comment provides provenance (Form A, TOML flavor).
 * Optional model / model_reasoning_effort are NOT emitted in the safe default
 * (§12, TQ-2).
 *
 * @param agent - The canonical agent record.
 * @returns The complete TOML document string.
 */
declare function renderCodexAgentToml(agent: AgentRecord): string;
```

RESOLVED — byte-stable TOML via `smol-toml@^1.3.0` (see
`01-architecture-layout.md` §3 `package.json`). Residual carry-forward:
verify/pre-sort `smol-toml` key ordering and use TOML triple-quoted literals
(`'''…'''`) for multiline `developer_instructions` to satisfy REQ-EMIT-06, with
deterministic escaping.

### 7.6 Before/after example

**Canonical** `agents/doc-reviewer.md`:

```markdown
---
name: doc-reviewer
description: Reviews documentation for clarity.
tools: [Read, Grep]
model: opus
---
You review docs for clarity and accuracy...
```

**Emitted** `adapters/codex/agents/doc-reviewer.toml`:

```toml
# GENERATED — DO NOT EDIT. Source: agents/doc-reviewer.md. Regenerate: bun run build
name = "doc-reviewer"
description = "Reviews documentation for clarity."
developer_instructions = '''
You review docs for clarity and accuracy...
'''
```

**Emitted** `adapters/codex/agents/openai.yaml` (Form C):

```yaml
_generated:
  source: agents/*
  regenerate: bun run build
agents:
  - name: doc-reviewer
    description: Reviews documentation for clarity.
```

DropRecords: `agent.tools` (fallback), `agent.model` (fallback) — TQ-2.

## 8. Cursor target (`src/targets/cursor.ts`)

2026 research: skills map to **Rules** at `.cursor/rules/<n>.mdc` (MUST be `.mdc`)
with `{description, globs, alwaysApply}`; agents are `.cursor/agents/<n>.md`
(markdown, **not** `.mdc`) with `{name, description, model?, readonly?, is_background?}`;
commands are `.cursor/commands/<n>.md` (filename = command name, body = prompt) with
**no confirmed structured argument syntax**.

### 8.1 Rules table

| Construct | Emitted file | Format | Frontmatter / fields | Drops |
|-----------|-------------|--------|----------------------|-------|
| skill | `rules/<n>.mdc` | mdc+YAML | `{description, globs: [], alwaysApply: false}` | `name` (in filename), `metadata`, `argument-hint`, `allowed-tools` → fallback |
| agent | `agents/<n>.md` | md+YAML | `{name, description}` | every `claudeKey` (no tools allowlist; `readonly` bool only) → fallback |
| command | `commands/<n>.md` | md (body only) | none (filename = name) | `argument-hint` → fallback (no structured args, MEDIUM-LOW) |

### 8.2 Transforms

```typescript
export const cursorTransform: TargetTransform = {
  target: "cursor",

  transformSkill(skill) {
    const fields = orderFrontmatter(
      new Map<string, unknown>([
        ["description", skill.description],
        ["globs", []],            // deterministic default (REQ-EMIT-06)
        ["alwaysApply", false],
      ]),
    );
    const content = renderFrontmatter(fields, skill.body, skill.sourcePath);
    const drops: DropRecord[] = [];
    if (hintValue(skill) !== undefined) {
      drops.push({ target: "cursor", source: skill.sourcePath, construct: "skill.argument-hint",
        kind: "fallback", reason: "no Cursor .mdc invocation-hint field" });
    }
    if (skill.metadata.size > 0) {
      drops.push({ target: "cursor", source: skill.sourcePath, construct: "skill.metadata",
        kind: "fallback", reason: "Cursor rules carry only {description, globs, alwaysApply}" });
    }
    return { files: [{ relpath: `rules/${skill.name}.mdc`, content, mode: 0o644 }], drops, manifestEntries: [] };
  },

  transformAgent(agent) {
    const fields = orderFrontmatter(
      new Map<string, unknown>([["name", agent.name], ["description", agent.description]]),
    );
    const content = renderFrontmatter(fields, agent.body, agent.sourcePath);
    const drops = dropAllClaudeKeys(agent, "cursor",
      "Cursor agents have no tools allowlist (readonly bool only); structural keys dropped");
    return { files: [{ relpath: `agents/${agent.name}.md`, content, mode: 0o644 }], drops, manifestEntries: [] };
  },

  transformCommand(command) {
    // Body-only prompt file; argument-hint flattened to prose is OUT OF SCOPE — dropped with record.
    const body = command.body;
    const drops: DropRecord[] = [{ target: "cursor", source: command.sourcePath,
      construct: "command.argument-hint", kind: "fallback",
      reason: "no confirmed Cursor structured argument syntax (MEDIUM-LOW); argument-hint dropped" }];
    // Provenance Form B (no frontmatter): HTML comment atop the body.
    const content = PROVENANCE.htmlComment() + "\n\n" + body;
    return { files: [{ relpath: `commands/${command.name}.md`, content, mode: 0o644 }], drops, manifestEntries: [] };
  },

  aggregateManifest: () => null,
};
```

WARNING (MEDIUM-LOW): Cursor command argument handling is unconfirmed. The safe
default drops `argument-hint` with a record rather than inventing a `$1`/`{{args}}`
syntax. If Cursor 2.4 confirms a command-arg form, upgrade this from a drop to a
mapping. Cursor 2.4 also ships `.cursor/skills/`; we emit the **rules** form as
primary per the research — note but do not emit the skills form this version.

### 8.3 Before/after example

**Canonical** `skills/graphify/SKILL.md` (excerpt) with `metadata.argument-hint`.

**Emitted** `adapters/cursor/rules/graphify.mdc`:

```mdc
---
# GENERATED — DO NOT EDIT. Source: skills/graphify/SKILL.md. Regenerate: bun run build
description: Turn any input into a knowledge graph.
globs: []
alwaysApply: false
---
<skill body…>
```

DropRecords: `skill.argument-hint` (fallback), `skill.metadata` (fallback).

## 9. Gemini target (`src/targets/gemini.ts`)

2026 research: skills emit `skills/<n>/<n>.md` (`{name, description}`) AND register
in `gemini-extension.json`; agents emit `.gemini/agents/<n>.md`
(`{name, description}`, optional `tools`/`model`); commands emit
`.gemini/commands/<n>.toml` (**TOML**, required `prompt`, optional `description`,
args via `{{args}}`). Gemini `:` subdir command namespacing is **OUT of scope for
v1** — see §9.2 note.

### 9.1 Rules table

| Construct | Emitted file | Format | Frontmatter / fields | Drops |
|-----------|-------------|--------|----------------------|-------|
| skill | `skills/<n>/<n>.md` | md+YAML | `{name, description}` | `metadata`, `argument-hint`, `allowed-tools` → fallback; **+ aggregate entry** |
| agent | `agents/<n>.md` | md+YAML | `{name, description}` | every `claudeKey` → fallback |
| command | `commands/<n>.toml` | TOML | `prompt` (= body), `description` | `argument-hint` → fallback (note added into prompt as prose) |
| aggregate | `gemini-extension.json` | JSON | `{_generated, name, version, skills: [{name, description}]}` | — |

### 9.2 Transforms

```typescript
export const geminiTransform: TargetTransform = {
  target: "gemini",

  transformSkill(skill) {
    const fields = orderFrontmatter(
      new Map<string, unknown>([["name", skill.name], ["description", skill.description]]),
    );
    const content = renderFrontmatter(fields, skill.body, skill.sourcePath);
    const drops: DropRecord[] = [];
    if (skill.metadata.size > 0) {
      drops.push({ target: "gemini", source: skill.sourcePath, construct: "skill.metadata",
        kind: "fallback", reason: "Gemini skill carries only {name, description}; metadata dropped" });
    }
    return {
      files: [{ relpath: `skills/${skill.name}/${skill.name}.md`, content, mode: 0o644 }],
      drops,
      manifestEntries: [{ name: skill.name, description: skill.description }],
    };
  },

  transformAgent(agent) {
    const fields = orderFrontmatter(
      new Map<string, unknown>([["name", agent.name], ["description", agent.description]]),
    );
    const content = renderFrontmatter(fields, agent.body, agent.sourcePath);
    const drops = dropAllClaudeKeys(agent, "gemini",
      "Gemini agent frontmatter carries only {name, description}; structural keys dropped");
    return { files: [{ relpath: `agents/${agent.name}.md`, content, mode: 0o644 }], drops, manifestEntries: [] };
  },

  transformCommand(command) {
    // Map body → prompt, description → description. argument-hint has no native field:
    // appended into the prompt as a prose note, AND drop-recorded (REQ-EMIT-03/03a).
    const prompt = command.argumentHint !== undefined
      ? `${command.body}\n\nArguments: ${command.argumentHint}`
      : command.body;
    const content = renderGeminiCommandToml(command.name, command.description, prompt, command.sourcePath);
    const drops: DropRecord[] = [];
    if (command.argumentHint !== undefined) {
      drops.push({ target: "gemini", source: command.sourcePath, construct: "command.argument-hint",
        kind: "fallback", reason: "Gemini commands have no argument-hint field; flattened into prompt prose" });
    }
    return { files: [{ relpath: `commands/${command.name}.toml`, content, mode: 0o644 }], drops, manifestEntries: [] };
  },

  // identity = { name, version } threaded from the resolved PluginMeta (07 §3.2,
  // the single source of project identity). The engine in 05 passes it through;
  // other targets ignore the second arg (their aggregateManifest is a no-op/null).
  aggregateManifest(entries, identity: { name: string; version: string }) {
    if (entries.length === 0) return null;
    // Form C: _generated FIRST key in strict JSON. entries pre-sorted by name (05).
    const doc = {
      _generated: { source: "skills/*", regenerate: REGEN_CMD },
      name: identity.name,        // from resolved PluginMeta (07 §3.2), not a literal
      version: identity.version,  // from resolved PluginMeta (07 §3.2), not a literal
      skills: entries.map((e) => ({ name: e.name, description: e.description })),
    };
    const content = JSON.stringify(doc, null, 2) + "\n"; // strict JSON, 2-space, trailing \n (REQ-EMIT-06)
    return { relpath: "gemini-extension.json", content, mode: 0o644 };
  },
};
```

`renderGeminiCommandToml` emits a leading `# GENERATED …` TOML comment, then
`description = "…"` and a triple-quoted `prompt = '''…'''` in fixed order. Gemini
`:` subdir command namespacing (`a/b.toml` → command `a:b`) is **OUT of scope for
v1**: nested command sources are flattened/not supported — the per-command transform
sees a flat `name` and emits `commands/<name>.toml` only. The MVP `docs-helper`
sample (`07-packaging-and-sample-tool.md`) has no nested commands, so no flattening
or `:` mapping is exercised. (No engine performs `:` namespacing this version.)

WARNING (LOW): the research notes Gemini's `GEMINI.md` context file has **no
frontmatter**. We do NOT emit a `GEMINI.md`; we emit per-skill `.md` + the
extension manifest. If a future version wants a `GEMINI.md` aggregate, it is Form B
(HTML comment) — flagged but not implemented here.

### 9.3 `gemini-extension.json` example (Form C)

The `name`/`version` below are illustrative values produced from the resolved
`PluginMeta` identity (07 §3.2) threaded into `aggregateManifest` — they are not
hardcoded by the transform.

```json
{
  "_generated": { "source": "skills/*", "regenerate": "bun run build" },
  "name": "agent-docs",
  "version": "0.1.0",
  "skills": [
    { "name": "graphify", "description": "Turn any input into a knowledge graph." }
  ]
}
```

### 9.4 Schema validation (REQ-VALID-03)

`gemini-extension.json` and `agents/openai.yaml` are the two aggregate manifests
with a defined target schema. `06-validation-and-drift-guard.md` validates the
emitted aggregate against that schema. This document guarantees the **shape**
(`_generated` first, then the manifest body); the JSON-Schema check lives in `06`.

## 10. Copilot target (`src/targets/copilot.ts`)

2026 research: skills map to **Instructions** at
`.github/instructions/<n>.instructions.md` (`{description, applyTo}`); agents emit
`.github/agents/<n>.agent.md` (current form; legacy `.chatmode.md`) with
`{description, name, tools?, model?}`; commands map cleanly to
`.github/prompts/<n>.prompt.md` (`{description, name, argument-hint?, model?, tools?}`)
— argument-hint maps cleanly (HIGH confidence). **No aggregate manifest.**

### 10.1 Rules table

| Construct | Emitted file | Format | Frontmatter / fields | Drops |
|-----------|-------------|--------|----------------------|-------|
| skill | `instructions/<n>.instructions.md` | md+YAML | `{description, applyTo: "**"}` | `name` (in filename), `metadata`, `argument-hint`, `allowed-tools` → fallback |
| agent | `agents/<n>.agent.md` | md+YAML | `{name, description}` (+ `tools` only if present & representable) | structural `claudeKeys` minus represented → fallback |
| command | `prompts/<n>.prompt.md` | md+YAML | `{name, description, argument-hint?}` | none (argument-hint maps cleanly, HIGH) |

### 10.2 Transforms

```typescript
export const copilotTransform: TargetTransform = {
  target: "copilot",

  transformSkill(skill) {
    const fields = orderFrontmatter(
      new Map<string, unknown>([
        ["description", skill.description],
        ["applyTo", "**"],     // repo-wide default (deterministic, REQ-EMIT-06)
      ]),
    );
    const content = renderFrontmatter(fields, skill.body, skill.sourcePath);
    const drops: DropRecord[] = [];
    if (hintValue(skill) !== undefined) {
      drops.push({ target: "copilot", source: skill.sourcePath, construct: "skill.argument-hint",
        kind: "fallback", reason: "Copilot instructions carry no invocation hint" });
    }
    if (skill.metadata.size > 0) {
      drops.push({ target: "copilot", source: skill.sourcePath, construct: "skill.metadata",
        kind: "fallback", reason: "Copilot instructions carry only {description, applyTo}" });
    }
    return {
      files: [{ relpath: `instructions/${skill.name}.instructions.md`, content, mode: 0o644 }],
      drops,
      manifestEntries: [],
    };
  },

  transformAgent(agent) {
    // Copilot .agent.md DOES support a tools array → keep `tools` if present, drop the rest.
    const KEEP: ReadonlySet<string> = new Set(["tools", "model"]); // §12: confirm tools/model shape
    const fields = new Map<string, unknown>([["name", agent.name], ["description", agent.description]]);
    for (const k of KEEP) if (agent.claudeKeys.has(k)) fields.set(k, agent.claudeKeys.get(k));
    const content = renderFrontmatter(orderFrontmatter(fields), agent.body, agent.sourcePath);
    const drops = dropAllClaudeKeys(agent, "copilot",
      "not representable in Copilot .agent.md frontmatter", KEEP);
    return { files: [{ relpath: `agents/${agent.name}.agent.md`, content, mode: 0o644 }], drops, manifestEntries: [] };
  },

  transformCommand(command) {
    const fields = new Map<string, unknown>([["name", command.name], ["description", command.description]]);
    if (command.argumentHint !== undefined) fields.set("argument-hint", command.argumentHint);
    const content = renderFrontmatter(orderFrontmatter(fields), command.body, command.sourcePath);
    return {
      files: [{ relpath: `prompts/${command.name}.prompt.md`, content, mode: 0o644 }],
      drops: [], // argument-hint maps cleanly (HIGH)
      manifestEntries: [],
    };
  },

  aggregateManifest: () => null,
};
```

WARNING (MEDIUM): the §12 list flags `.agent.md` vs legacy `.chatmode.md`. We emit
`.agent.md` (current). The `tools`/`model` keep-set assumes Copilot's `.agent.md`
frontmatter accepts a `tools` array and `model` scalar in the same shape as Claude;
verify the exact serialization (Claude `tools` may be a list of tool names; Copilot
may expect a different vocabulary). If unconfirmed, set `KEEP = new Set()` and drop
both with records (the conservative default).

### 10.3 Before/after example

**Canonical** `commands/summarize.md` (as §6.5) →
**Emitted** `adapters/copilot/prompts/summarize.prompt.md`:

```markdown
---
# GENERATED — DO NOT EDIT. Source: commands/summarize.md. Regenerate: bun run build
name: summarize
description: Summarize the current document.
argument-hint: "[path]"
---
Summarize the document at the given path...
```

DropRecords: none (commands map cleanly to Copilot prompts).

## 11. Determinism contract (REQ-EMIT-06 / REQ-REL-01)

Every transform in this document MUST satisfy:

- **No I/O, no clock, no RNG.** Transforms are pure functions of their record input.
- **Fixed frontmatter order** via `orderFrontmatter` (§4.2) → `KEY_ORDER` (`00` §5).
- **Fixed file order** by the engine iterating `TARGET_ORDER` (`00` §5) and the
  POSIX-sorted record arrays from `03`.
- **Deterministic defaults**: `globs: []`, `alwaysApply: false`, `applyTo: "**"` are
  literals, never derived from the environment.
- **Aggregate entries pre-sorted by `name`** before `aggregateManifest` is called;
  `_generated` is always the first serialized key (Form C).
- **JSON**: `JSON.stringify(doc, null, 2) + "\n"` (2-space, trailing newline). YAML:
  `YAML_OPTS` (`sortKeys: false`). TOML: fixed key order + deterministic escaping.

Re-running a transform on the same record yields a byte-identical `TransformOutput`.

## 12. TQ Resolution

### TQ-1 — native slash-command formats per target (RESOLVED)

| Target | Command form | Confidence | Disposition |
|--------|-------------|-----------|-------------|
| claude | `commands/<n>.md` full frontmatter incl. `argument-hint` | HIGH (native) | clean, no drops |
| copilot | `prompts/<n>.prompt.md` `{name, description, argument-hint?}` | HIGH | clean map, argument-hint preserved |
| gemini | `commands/<n>.toml` `{prompt, description}`, `{{args}}` | MEDIUM | map body→prompt; argument-hint → prose note + drop record |
| codex | `prompts/<n>.md` `{description, argument-hint}` | MEDIUM, **DEPRECATED** | emit + DEPRECATION fallback record |
| cursor | `commands/<n>.md` body-only prompt | MEDIUM-LOW (args unconfirmed) | emit body; argument-hint dropped with record |

### TQ-2 — Codex agent structural keys (RESOLVED: drop-with-record default)

Codex agents are TOML (`.codex/agents/<n>.toml`) with `name`, `description`,
`developer_instructions`. There is **no per-agent `tools` array** (tool restriction
is a config-layer concern). The safe default keeps `CODEX_AGENT_KEYS` **empty** and
drop-records every Claude `claudeKey` (`tools`, `model`, `maxTurns`, `effort`,
`memory`, `skills`). `model`/`model_reasoning_effort` MAY be representable but are
low confidence — expanding the keep-set is a deliberate future change once verified.

### Low-confidence WARNING list (verify before implementing)

- **WARNING (Codex agent format):** Could not confirm the exact `.codex/agents/<n>.toml`
  field names against a primary source from this environment. MEDIUM confidence on
  `developer_instructions`; verify whether it is `instructions` vs
  `developer_instructions`, and whether `model`/`model_reasoning_effort` are accepted.
- **WARNING (Codex user-skills path):** research notes `~/.codex` vs an `~/.agents`
  location ambiguity for user-scoped skills. This document emits the **project**
  `.codex/`-relative tree only; the user-scoped path is out of scope.
- **WARNING (Codex prompts deprecation):** OpenAI marks prompts deprecated in favor
  of Skills; we emit and record a fallback. Confirm whether to suppress prompt
  emission entirely in a later version.
- **WARNING (Cursor command args):** no confirmed structured argument syntax;
  `argument-hint` is dropped with a record (MEDIUM-LOW), not mapped.
- **WARNING (Gemini GEMINI.md frontmatter):** `GEMINI.md` has no frontmatter (LOW);
  we do not emit it — per-skill `.md` + `gemini-extension.json` only.
- **RESOLVED (Gemini extension name/version):** the extension `name`/`version` are
  **not** hardcoded; gemini's `aggregateManifest(entries, identity)` receives a
  `{ name, version }` identity threaded from the resolved `PluginMeta`
  (`07-packaging-and-sample-tool.md` §3.2, the single source of project identity).
  §9.2/§9.3 reflect this.
- **WARNING (Copilot mode vs agent):** `.github/agents/<n>.agent.md` (current) is
  emitted over legacy `.github/chatmodes/<n>.chatmode.md`. The `tools`/`model`
  keep-set for `.agent.md` is MEDIUM; default to dropping both if unconfirmed.
- **RESOLVED (TOML serializer):** byte-stable TOML via `smol-toml@^1.3.0` (committed
  in `01-architecture-layout.md` §3 `package.json`), used by Codex agents and Gemini
  commands. Residual carry-forward: verify/pre-sort `smol-toml` key ordering and use
  TOML triple-quoted literals (`'''…'''`) for multiline strings to satisfy REQ-EMIT-06.

These supersede feature-forge where they differ: feature-forge emitted **markdown**
codex agents and Cursor `.mdc` agents and had **no** TOML or `.agent.md`/`.toml`
command forms; the 2026 research above is authoritative for agent-docs.

## Verification

- [ ] `TRANSFORMS` has exactly the five `Target` keys; `index.ts` exports it and the
      engine iterates `TARGET_ORDER`, not object order (REQ-EMIT-06).
- [ ] `claudeTransform` produces **zero** DropRecords for any skill/agent/command
      (REQ-EMIT-07, CON-03).
- [ ] Every non-claude transform that loses a construct returns a non-empty `drops`
      array with `kind` ∈ {`fallback`, `skipped`} — no silent path (REQ-EMIT-03).
      Grep: no `return { files, drops: [], … }` on a branch where metadata/argument-hint/
      claudeKeys were present.
- [ ] Codex `transformAgent` emits `.toml`, contributes one `ManifestEntry`, and
      drop-records every `claudeKey` (TQ-2 empty keep-set).
- [ ] Codex `aggregateManifest` emits `agents/openai.yaml` with `_generated` first
      (Form C); gemini emits `gemini-extension.json` with `_generated` first.
- [ ] Cursor skills emit `rules/<n>.mdc` (extension `.mdc`); Cursor agents emit
      `agents/<n>.md` (extension `.md`, NOT `.mdc`).
- [ ] Copilot skills emit `instructions/<n>.instructions.md`; agents emit
      `agents/<n>.agent.md`; commands emit `prompts/<n>.prompt.md` with argument-hint
      preserved (no drop).
- [ ] Gemini commands emit `commands/<n>.toml` and contribute no aggregate entry;
      gemini skills DO contribute an aggregate entry.
- [ ] Every emitted frontmatter file's first in-block line is the `PROVENANCE.yamlComment`
      provenance comment (Form A); JSON/YAML aggregates lead with `_generated` (Form C);
      Cursor command body files lead with `PROVENANCE.htmlComment` (Form B).
- [ ] Running any transform twice on the same record yields byte-identical output
      (REQ-EMIT-06); frontmatter keys appear in `KEY_ORDER` (REQ-EMIT-06).
- [ ] Aggregate entries are sorted by `name` before serialization (deterministic).
