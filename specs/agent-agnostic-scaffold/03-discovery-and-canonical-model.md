# 03 — Discovery & Canonical Model

The **read half** of the emitter: turning the manifest-enumerated canonical
(Claude-native) source into the in-memory record arrays that the per-target
transforms (`04-transforms.md`) consume. This document specifies two modules:

- **`src/frontmatter.ts`** — parse/serialize YAML frontmatter with byte-stable,
  order-preserving semantics.
- **`src/discover.ts`** — walk each `ToolEntry` from the manifest into a
  `SkillRecord` / `AgentRecord` / `CommandRecord`, plus collect the shared
  `references/` and `scripts/` trees.

All shared types (`ParsedDoc`, `SkillRecord`, `AgentRecord`, `CommandRecord`,
`EmitterConfig`, `ToolEntry`, `Manifest`), the error classes
(`MalformedFrontmatterError`, `SourceNotFoundError`, `PathEscapeError`), and the
constants (`KEY_ORDER`, `YAML_OPTS`) come from `00-core-definitions.md` and are
**referenced, not redefined** here. Layout (`skills/<name>/SKILL.md`,
`agents/<name>.md`, `commands/<name>.md`, shared `references/`/`scripts/`) is
defined in `01-architecture-layout.md`.

Discovery is **manifest-driven** (REQ-DISC-01/02), NOT filesystem globbing — but it
emits records in a **stable POSIX-path sort** so downstream emission is byte-stable
(REQ-EMIT-06). This is the key divergence from feature-forge's
`scripts/build-adapters.py`, which globs `skills/*/SKILL.md`
(`/home/gary/workspace/feature-forge/scripts/build-adapters.py:360,365`); the
parse/split/record logic is otherwise ported from that source.

## Requirement Coverage

| REQ ID                   | Requirement                                                                     | Section       |
| ------------------------ | ------------------------------------------------------------------------------- | ------------- |
| REQ-TOOLS-01             | Discover skills (SKILL.md + owned refs/scripts)                                 | 3.2, 3.3      |
| REQ-TOOLS-02             | Discover agents (system prompt, tool grants, triggers)                          | 3.4           |
| REQ-TOOLS-03             | Discover slash commands                                                         | 3.5           |
| REQ-TOOLS-04             | Discover shared references and scripts                                          | 3.6           |
| REQ-DISC-01/02           | Manifest is the single discovery input                                          | 3.1           |
| REQ-EMIT-06 / REQ-REL-01 | Stable POSIX-path sort; order-preserving frontmatter                            | 2.2, 3.1, 3.7 |
| REQ-SEC-01               | Reads confined to canonical roots; path-escape refused                          | 3.1, 3.8      |
| TQ-3                     | Canonical skill frontmatter shape; metadata/allowed-tools/argument-hint capture | 4             |

## 1. Dependencies

- `00-core-definitions.md` — `ParsedDoc`, `SkillRecord`, `AgentRecord`,
  `CommandRecord`, `Manifest`, `ToolEntry`, `EmitterConfig`, the error hierarchy,
  `KEY_ORDER`, `YAML_OPTS`.
- `01-architecture-layout.md` — canonical directory layout; `src/frontmatter.ts`,
  `src/discover.ts` module placement; `src/config.ts` resolving `EmitterConfig`
  to absolute roots; `src/paths.ts` confinement helpers (REQ-SEC-01).
- `02-manifest-and-config.md` — `loadManifest()` produces the validated `Manifest`
  whose `tools: ToolEntry[]` and `config: EmitterConfig` this module consumes.

Must be implemented **before** `04-transforms.md` and `05-overrides-publish-determinism.md`,
which consume the records produced here.

## 2. `src/frontmatter.ts` — order-preserving YAML frontmatter

Uses the `yaml` package (tech-spec §9). All public functions are pure (no I/O).

### 2.1 The frontmatter block contract

A canonical markdown file begins with a frontmatter block delimited by a column-0
`---` on the first line and the next column-0 `---`. Everything after the closing
delimiter is the **body**, preserved byte-for-byte (no reflow). Ported from
`split_frontmatter` (`build-adapters.py:407`).

```typescript
/** The delimiter line for a frontmatter block (column-0, exact). */
const FM_DELIM = "---";
```

### 2.2 `parseFrontmatter`

```typescript
import { parseDocument } from "yaml";
import type { ParsedDoc } from "./model.js";
import { MalformedFrontmatterError } from "./errors.js";

/**
 * Parse a canonical markdown file into ordered frontmatter + body.
 *
 * The frontmatter block is delimited by the first column-0 `---` and the next
 * column-0 `---`. The block is parsed with the `yaml` package and MUST be a
 * mapping. Map insertion order mirrors YAML document order (REQ-EMIT-06), so a
 * round-trip through {@link serializeFrontmatter} preserves author key order.
 *
 * Newlines are assumed already normalized to `\n` by the caller
 * (`src/discover.ts` reads via {@link readCanonicalText}).
 *
 * @param content - Full file contents, `\n`-normalized.
 * @param sourcePath - Repo-relative POSIX path, used only for error messages.
 * @returns The parsed frontmatter Map (insertion-ordered) and the body string.
 * @throws {MalformedFrontmatterError} when there is no balanced `---/---` pair,
 *   the block fails to parse as YAML, or the block is not a mapping.
 */
export function parseFrontmatter(content: string, sourcePath: string): ParsedDoc {
  const lines = content.split("\n");
  if (lines.length === 0 || lines[0]?.trim() !== FM_DELIM) {
    throw new MalformedFrontmatterError(
      `${sourcePath}: missing opening frontmatter '---'`,
      sourcePath,
    );
  }
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === FM_DELIM) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx === -1) {
    throw new MalformedFrontmatterError(
      `${sourcePath}: missing closing frontmatter '---'`,
      sourcePath,
    );
  }

  const block = lines.slice(1, closeIdx).join("\n");
  const body = lines.slice(closeIdx + 1).join("\n");

  let doc;
  try {
    doc = parseDocument(block, { keepSourceTokens: false });
  } catch (err) {
    throw new MalformedFrontmatterError(
      `${sourcePath}: invalid YAML frontmatter: ${(err as Error).message}`,
      sourcePath,
    );
  }
  if (doc.errors.length > 0) {
    throw new MalformedFrontmatterError(
      `${sourcePath}: invalid YAML frontmatter: ${doc.errors[0]!.message}`,
      sourcePath,
    );
  }
  const value = doc.toJS({ mapAsMap: true });
  if (!(value instanceof Map)) {
    throw new MalformedFrontmatterError(
      `${sourcePath}: frontmatter is not a YAML mapping`,
      sourcePath,
    );
  }
  return { frontmatter: value as Map<string, unknown>, body };
}
```

`toJS({ mapAsMap: true })` yields a `Map` whose insertion order is the YAML key
order — the order-preservation guarantee `ParsedDoc.frontmatter` promises
(`00-core-definitions.md` §3).

### 2.3 `serializeFrontmatter`

```typescript
import { Document, YAMLMap } from "yaml";
import { YAML_OPTS } from "./model.js";

/**
 * Serialize an ordered frontmatter Map + body back into a complete markdown
 * document with a `---`-delimited block.
 *
 * Keys are emitted in the Map's iteration order — callers (`04-transforms.md`)
 * pre-order the Map per `KEY_ORDER` (00 §5) before calling this, so output is
 * byte-stable (REQ-EMIT-06). Serialization uses `YAML_OPTS` (no key sorting, wide
 * line width) so the `yaml` writer never reorders or reflows. This function does
 * NOT inject a provenance header — that is `04-transforms.md`'s job (Form A).
 *
 * @param map - Ordered frontmatter keys → values.
 * @param body - The markdown body to append after the closing `---`.
 * @returns `---\n<yaml>---\n<body>` with a single `\n` after the closing delimiter.
 */
export function serializeFrontmatter(map: Map<string, unknown>, body: string): string {
  const doc = new Document();
  doc.contents = new YAMLMap();
  for (const [key, value] of map) {
    (doc.contents as YAMLMap).set(key, value);
  }
  const yaml = doc.toString(YAML_OPTS);
  // doc.toString() already ends with "\n"; the block is bracketed by delimiters.
  return `---\n${yaml}---\n${body}`;
}
```

Round-trip invariant (REQ-EMIT-06):
`parseFrontmatter(serializeFrontmatter(m, b))` yields an equal Map (same keys, same
order) and the same `b`, for any Map produced by `parseFrontmatter`.

## 3. `src/discover.ts` — canonical source → records

### 3.1 Entry point

```typescript
import type { Manifest, SkillRecord, AgentRecord, CommandRecord, ToolEntry } from "./model.js";

/** A shared (non-tool-owned) file copied verbatim into every adapter. */
export interface SharedFile {
  /** Repo-relative POSIX path under the canonical references/ or scripts/ root. */
  sourcePath: string;
  /** POSIX file mode: 0o644 for references, 0o755 for scripts (3.6). */
  mode: number;
}

/** Everything discovery extracts from the canonical source for one build. */
export interface DiscoveryResult {
  skills: SkillRecord[];
  agents: AgentRecord[];
  commands: CommandRecord[];
  /** Shared references/ tree, sorted by POSIX path. */
  sharedRefs: SharedFile[];
  /** Shared scripts/ tree, sorted by POSIX path. */
  sharedScripts: SharedFile[];
}

/** Resolved absolute canonical roots (from `src/config.ts`, REQ-REUSE-01). */
export interface Roots {
  /** Absolute repo root; every sourcePath is relative to this. */
  repoRoot: string;
  skillsDir: string;
  agentsDir: string;
  commandsDir: string;
  referencesDir: string;
  scriptsDir: string;
}

/**
 * Read every canonical artifact named by the manifest into in-memory records.
 *
 * Discovery is **manifest-driven** (REQ-DISC-01/02): only `ToolEntry`s in
 * `manifest.tools` are read — there is no filesystem globbing of skills/agents/
 * commands. Shared references/ and scripts/ ARE walked from disk (they are not
 * individually manifest-listed; REQ-TOOLS-04). Every output array is sorted by
 * POSIX `sourcePath` (REQ-EMIT-06) so downstream emission is byte-stable.
 *
 * All reads are confined to the canonical roots (REQ-SEC-01): a `ToolEntry.source`
 * that resolves outside `roots` is refused with `PathEscapeError` before any read.
 *
 * @param manifest - The validated manifest (`02-manifest-and-config.md`).
 * @param roots - Absolute canonical roots resolved from `manifest.config`.
 * @returns Sorted record arrays + shared file lists.
 * @throws {SourceNotFoundError} a tool's `source` does not exist on disk.
 * @throws {MalformedFrontmatterError} a canonical file has bad/missing frontmatter.
 * @throws {PathEscapeError} a `source` resolves outside the canonical roots.
 */
export function discover(manifest: Manifest, roots: Roots): DiscoveryResult;
```

Dispatch by `ToolEntry.type` (`00` §2.1 `ToolType`):

| `type`      | Handler                                                   | Record          |
| ----------- | --------------------------------------------------------- | --------------- |
| `skill`     | `parseSkill` (3.3)                                        | `SkillRecord`   |
| `agent`     | `parseAgent` (3.4)                                        | `AgentRecord`   |
| `command`   | `parseCommand` (3.5)                                      | `CommandRecord` |
| `script`    | collected as owned-by-manifest into `sharedScripts` (3.6) | `SharedFile`    |
| `reference` | collected into `sharedRefs` (3.6)                         | `SharedFile`    |

After dispatch, each record array and the shared lists are sorted:
`arr.sort((a, b) => (a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0))`.
This is a plain code-unit (UTF-16) comparison on already-ASCII kebab-case POSIX
paths, which is byte-order-equivalent for the allowed name charset
(`^[a-z0-9]+(-[a-z0-9]+)*$`, `00` §2.2) — matching feature-forge's `LC_ALL=C`
byte sort (`build-adapters.py:372`).

### 3.2 Shared file read helper

```typescript
import { readFileSync, statSync, existsSync } from "node:fs";
import { SourceNotFoundError } from "./errors.js";

/**
 * Read a canonical file as UTF-8 with `\n`-normalized newlines.
 * Ported from `read_canon_text` (build-adapters.py:448).
 *
 * @throws {SourceNotFoundError} the path does not exist.
 */
function readCanonicalText(absPath: string, sourcePath: string): string {
  if (!existsSync(absPath)) {
    throw new SourceNotFoundError(`${sourcePath}: source not found`, sourcePath);
  }
  const raw = readFileSync(absPath, "utf8");
  return raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
```

### 3.3 `parseSkill` (REQ-TOOLS-01)

Reads `skills/<name>/SKILL.md` and, if present, the skill-owned `references/` and
`scripts/` subdirectories. Ported from `parse_skill` (`build-adapters.py:468`),
extended for owned `scripts/` and the TQ-3 metadata split (§4).

```typescript
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter.js";
import { MalformedFrontmatterError } from "./errors.js";

function parseSkill(entry: ToolEntry, roots: Roots): SkillRecord {
  const sourcePath = entry.source; // e.g. "skills/<name>/SKILL.md"
  const absPath = resolveConfined(roots.repoRoot, sourcePath); // 3.8
  const { frontmatter, body } = parseFrontmatter(
    readCanonicalText(absPath, sourcePath),
    sourcePath,
  );

  // name: required, MUST equal the parent directory name (REQ-DISC cross-check, TQ-4).
  const name = frontmatter.get("name");
  if (typeof name !== "string" || name.length === 0) {
    throw new MalformedFrontmatterError(`${sourcePath}: missing or non-string 'name'`, sourcePath);
  }
  const dirName = basenameOfParent(absPath); // skills/<dirName>/SKILL.md
  if (name !== dirName) {
    throw new MalformedFrontmatterError(
      `${sourcePath}: name '${name}' != directory '${dirName}'`,
      sourcePath,
    );
  }
  if (name !== entry.name) {
    throw new MalformedFrontmatterError(
      `${sourcePath}: name '${name}' != manifest entry '${entry.name}'`,
      sourcePath,
    );
  }

  // description: optional string, preserved byte-for-byte.
  const description = frontmatter.get("description") ?? "";
  if (typeof description !== "string") {
    throw new MalformedFrontmatterError(`${sourcePath}: 'description' is not a string`, sourcePath);
  }

  // metadata = ALL remaining frontmatter beyond name/description (§4, TQ-3).
  const metadata = new Map<string, unknown>();
  for (const [k, v] of frontmatter) {
    if (k !== "name" && k !== "description") metadata.set(k, v);
  }

  // Skill-owned references/ + scripts/ (REQ-TOOLS-01). Whole-tree, POSIX-sorted.
  const ownRefs = collectOwnedTree(absPath, roots, sourcePath);

  return { name, description, metadata, body, ownRefs, sourcePath };
}
```

`ownRefs` collects every file under the skill's sibling `references/` and `scripts/`
directories (relative to the `SKILL.md` parent), returning repo-relative POSIX
paths sorted ascending. Scripts retain a `0o755` mode marker for verbatim copy in
`05-overrides-publish-determinism.md`; the `SkillRecord.ownRefs: string[]` field (`00` §3)
carries paths only — the mode is recomputed at copy time from the source file's
executable bit (§3.6). Where the executable bit must be known at discovery time for
a skill-owned script, discovery preserves it by listing the path under
`scripts/` and re-`stat`-ing at publish; no mode is lost.

### 3.4 `parseAgent` (REQ-TOOLS-02)

Reads `agents/<name>.md`. The agent's system prompt is the body; tool grants,
model, triggering conditions, etc. are **non-fixed** Claude-only frontmatter keys
captured in insertion order into `claudeKeys` (so a future agent key is
auto-covered). Ported from `parse_agent` (`build-adapters.py:515`).

```typescript
function parseAgent(entry: ToolEntry, roots: Roots): AgentRecord {
  const sourcePath = entry.source; // "agents/<name>.md"
  const absPath = resolveConfined(roots.repoRoot, sourcePath);
  const { frontmatter, body } = parseFrontmatter(
    readCanonicalText(absPath, sourcePath),
    sourcePath,
  );

  const name = frontmatter.get("name");
  if (typeof name !== "string" || name.length === 0) {
    throw new MalformedFrontmatterError(`${sourcePath}: missing or non-string 'name'`, sourcePath);
  }
  if (name !== stemOf(absPath) || name !== entry.name) {
    throw new MalformedFrontmatterError(
      `${sourcePath}: name '${name}' != file stem / manifest entry`,
      sourcePath,
    );
  }

  const description = frontmatter.get("description") ?? "";
  if (typeof description !== "string") {
    throw new MalformedFrontmatterError(`${sourcePath}: 'description' is not a string`, sourcePath);
  }

  // claudeKeys = frontmatter MINUS name/description, source order preserved.
  const claudeKeys = new Map<string, unknown>();
  for (const [k, v] of frontmatter) {
    if (k !== "name" && k !== "description") claudeKeys.set(k, v);
  }

  return { name, description, claudeKeys, body, sourcePath };
}
```

These `claudeKeys` (e.g. `tools`, `model`, `maxTurns`, `effort`, `memory`, `skills`
— see `KEY_ORDER`, `00` §5) are retained whole for Claude and selectively dropped
per target by `04-transforms.md` (and recorded as drops, REQ-EMIT-03). Whether any
of them is representable on Codex is the open TQ-2 — default is drop-with-record,
decided in `04-transforms.md`.

### 3.5 `parseCommand` (REQ-TOOLS-03)

New in agent-docs (no feature-forge equivalent). Reads `commands/<name>.md`. The
only structured Claude command key beyond `name`/`description` is `argument-hint`,
which is split out into the optional `argumentHint` field; the rest of the body is
the command prompt.

```typescript
function parseCommand(entry: ToolEntry, roots: Roots): CommandRecord {
  const sourcePath = entry.source; // "commands/<name>.md"
  const absPath = resolveConfined(roots.repoRoot, sourcePath);
  const { frontmatter, body } = parseFrontmatter(
    readCanonicalText(absPath, sourcePath),
    sourcePath,
  );

  const name = frontmatter.get("name");
  if (typeof name !== "string" || name.length === 0) {
    throw new MalformedFrontmatterError(`${sourcePath}: missing or non-string 'name'`, sourcePath);
  }
  if (name !== stemOf(absPath) || name !== entry.name) {
    throw new MalformedFrontmatterError(
      `${sourcePath}: name '${name}' != file stem / manifest entry`,
      sourcePath,
    );
  }

  const description = frontmatter.get("description") ?? "";
  if (typeof description !== "string") {
    throw new MalformedFrontmatterError(`${sourcePath}: 'description' is not a string`, sourcePath);
  }

  const rawHint = frontmatter.get("argument-hint");
  if (rawHint !== undefined && typeof rawHint !== "string") {
    throw new MalformedFrontmatterError(
      `${sourcePath}: 'argument-hint' is not a string`,
      sourcePath,
    );
  }
  const argumentHint = rawHint as string | undefined;

  return { name, description, argumentHint, body, sourcePath };
}
```

`argument-hint` is native to Claude commands and is **dropped (with a record) on
every non-Claude target** by `04-transforms.md` (mirrors the skill argument-hint
drops in feature-forge, `build-adapters.py:711,764,825`).

### 3.6 Shared references & scripts (REQ-TOOLS-04)

The shared `references/` and `scripts/` roots are copied **verbatim** into every
adapter (`05-overrides-publish-determinism.md`); discovery enumerates them and records
each file's POSIX mode. `references` and `script` `ToolEntry`s in the manifest may
point at specific files/dirs; absent such entries, the whole shared tree under
`roots.referencesDir` / `roots.scriptsDir` is walked.

```typescript
/**
 * Walk a shared tree, returning sorted SharedFile entries with correct modes.
 * References → 0o644; scripts → 0o755 (executable bit carried for verbatim copy
 * in 05). The executable bit is read from the source file's mode and forced to
 * 0o755 for the scripts tree so copies are runnable regardless of the source's
 * exact bits (deterministic, REQ-EMIT-06).
 */
function collectSharedTree(absRoot: string, repoRoot: string, isScript: boolean): SharedFile[] {
  const out: SharedFile[] = [];
  for (const abs of walkFiles(absRoot)) {
    const sourcePath = toPosixRelative(repoRoot, abs);
    out.push({ sourcePath, mode: isScript ? 0o755 : 0o644 });
  }
  out.sort((a, b) => (a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0));
  return out;
}
```

Missing shared roots are not an error (a repo may have no shared references); an
empty array is returned. A `ToolEntry` of type `script`/`reference` whose `source`
is missing still raises `SourceNotFoundError` (it was explicitly registered).

### 3.7 Determinism summary (REQ-EMIT-06 / REQ-REL-01)

- Records emitted in stable POSIX-path sort (§3.1).
- Frontmatter key order preserved by `Map` insertion (§2).
- Bodies preserved byte-for-byte; newlines normalized to `\n` once at read (§3.2).
- File modes are deterministic constants per tree (§3.6), not copied raw bits.
- No timestamps, RNG, or environment reads in this module.

### 3.8 Path confinement (REQ-SEC-01)

```typescript
import { resolve, relative, isAbsolute } from "node:path";
import { PathEscapeError } from "./errors.js";

/**
 * Resolve a repo-relative source to an absolute path, refusing any path that
 * escapes the repo root (e.g. a `../` in a manifest `source`). Ports
 * feature-forge's `allowed_root` containment guard (tech-spec §3.6).
 *
 * @throws {PathEscapeError} when the resolved path is outside `repoRoot`.
 */
function resolveConfined(repoRoot: string, sourcePath: string): string {
  const abs = resolve(repoRoot, sourcePath);
  const rel = relative(repoRoot, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new PathEscapeError(`source escapes canonical root: ${sourcePath}`, sourcePath);
  }
  return abs;
}
```

`walkFiles` applies the same confinement to every traversed entry; reads are
limited to the canonical roots (REQ-SEC-01). `src/paths.ts`
(`01-architecture-layout.md`) is the shared home for these helpers; discovery
imports them rather than re-implementing.

## 4. TQ-3 resolution — canonical skill frontmatter shape

This document **fixes** the canonical skill frontmatter shape for agent-docs (the
TQ-3 resolution), so `04-transforms.md` can decide per-target what to keep/drop.

**Canonical agent-docs skill frontmatter:**

```yaml
---
name: <kebab-case, == directory name> # required
description: <string> # optional, byte-preserved
metadata: # optional mapping; ALL extra keys
  argument-hint: "<...>" #   live here, NOT at top level
  allowed-tools: [...] #   (e.g. allowed-tools, etc.)
---
```

Resolution rules:

1. **Only `name` and `description` are top-level recognized keys.** Everything
   else a skill author writes lives under a single `metadata` mapping. This mirrors
   feature-forge, which **relocates `argument-hint` into `metadata`** upstream
   (`build-adapters.py:64-68`: "this holds `{argument-hint: …}` relocated from
   Claude's top-level key").

2. **`SkillRecord.metadata` captures every frontmatter key beyond name/description,
   insertion order preserved** (§3.3). In the canonical shape that is normally the
   single `metadata` key (whose value is itself an ordered mapping containing
   `argument-hint`, `allowed-tools`, and any future per-skill key). If an author
   places extra top-level keys, they are still captured into `SkillRecord.metadata`
   verbatim and in order — discovery never silently drops a key.

3. **Per-target disposition is `04-transforms.md`'s decision**, made possible by
   this capture:
   - **Claude**: reconstruct the native shape (`metadata.argument-hint` may be
     surfaced as a top-level `argument-hint`, per feature-forge
     `build-adapters.py:669`), retain `metadata`.
   - **Codex / Copilot / Gemini**: emit `{name, description}` only; `metadata`
     (incl. `argument-hint`, `allowed-tools`) is dropped **with a `DropRecord`**
     (REQ-EMIT-03), never silently.
   - **Cursor**: emit `{description, globs, alwaysApply}`; `metadata` dropped with
     a record.

Because `SkillRecord.metadata` carries the full ordered remainder, no per-target
decision is foreclosed at discovery time — discovery is policy-free; transforms own
policy.

WARNING: feature-forge has no slash-command discovery and no shared `scripts/`
tree distinct from references — `parseCommand` (§3.5) and the scripts-mode handling
(§3.6) are net-new (tech-spec §6 WARNING) and have no reference implementation;
they are designed fresh against REQ-TOOLS-03/04 here.

## 5. Example

Given `tools.manifest.json`:

```json
{
  "version": 1,
  "tools": [
    { "name": "graphify", "type": "skill", "source": "skills/graphify/SKILL.md" },
    { "name": "doc-reviewer", "type": "agent", "source": "agents/doc-reviewer.md" },
    { "name": "summarize", "type": "command", "source": "commands/summarize.md" }
  ]
}
```

and `commands/summarize.md`:

```markdown
---
name: summarize
description: Summarize the current document.
argument-hint: "[path]"
---

Summarize the document at the given path...
```

`discover(manifest, roots)` returns:

```typescript
{
  skills: [ { name: "graphify", description: "...", metadata: Map(1){ "metadata" => Map{...} }, ownRefs: [...], sourcePath: "skills/graphify/SKILL.md", body: "..." } ],
  agents: [ { name: "doc-reviewer", claudeKeys: Map{ "tools" => [...], "model" => "..." }, sourcePath: "agents/doc-reviewer.md", ... } ],
  commands: [ { name: "summarize", description: "Summarize the current document.", argumentHint: "[path]", sourcePath: "commands/summarize.md", body: "Summarize the document..." } ],
  sharedRefs: [ /* SharedFile, mode 0o644, sorted */ ],
  sharedScripts: [ /* SharedFile, mode 0o755, sorted */ ],
}
```

## Verification

- [ ] `parseFrontmatter` round-trips: for any canonical file, re-serializing the
      parsed Map (same order) + body and re-parsing yields an equal Map and the
      same body (REQ-EMIT-06).
- [ ] `parseFrontmatter` throws `MalformedFrontmatterError` for: missing opening
      `---`, missing closing `---`, non-mapping block, and invalid YAML — each with
      `sourcePath` populated.
- [ ] `discover` reads ONLY manifest-listed tools for skills/agents/commands (a
      stray `skills/orphan/SKILL.md` not in the manifest is ignored), proving
      manifest-driven discovery (REQ-DISC-01/02).
- [ ] Every output array is sorted ascending by `sourcePath`; shuffling manifest
      order produces identical record order (REQ-EMIT-06).
- [ ] A skill whose frontmatter `name` differs from its directory name, file stem,
      or manifest entry raises `MalformedFrontmatterError` (TQ-4 cross-check).
- [ ] `SkillRecord.metadata` contains every non-name/description key in source
      order; `argument-hint`/`allowed-tools` nested under `metadata` survive (TQ-3).
- [ ] `AgentRecord.claudeKeys` preserves source order and excludes name/description.
- [ ] `CommandRecord.argumentHint` is set from `argument-hint` and `undefined` when
      absent (REQ-TOOLS-03).
- [ ] `sharedScripts` entries carry mode `0o755`; `sharedRefs` carry `0o644`
      (REQ-TOOLS-04, script executable bit for verbatim copy in 05).
- [ ] A `source` containing `../` that escapes the repo root raises
      `PathEscapeError` before any read (REQ-SEC-01).
- [ ] A missing `source` for a registered tool raises `SourceNotFoundError`.
