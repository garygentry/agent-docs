import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";

import type { AgentRecord, CommandRecord, Manifest, SkillRecord, ToolEntry } from "./model.js";
import type { ResolvedRoots } from "./config.js";
import { parseFrontmatter } from "./frontmatter.js";
import { confinePath } from "./paths.js";
import { MalformedFrontmatterError, SourceNotFoundError } from "./errors.js";

/**
 * Canonical source discovery (03 §3): walk each manifest-listed {@link ToolEntry}
 * into a typed {@link SkillRecord}/{@link AgentRecord}/{@link CommandRecord}, plus
 * collect the shared `references/` and `scripts/` trees as {@link SharedFile}s.
 *
 * Discovery is manifest-driven (REQ-DISC-01/02): only `manifest.tools` entries are
 * read for skills/agents/commands — there is no filesystem globbing. Shared
 * references/scripts ARE walked from disk (REQ-TOOLS-04). Every output array is
 * sorted by POSIX `sourcePath` so downstream emission is byte-stable (REQ-EMIT-06).
 * All reads are confined to the canonical roots via {@link confinePath}
 * (PathEscapeError on escape, REQ-SEC-01).
 */

/** A shared (non-tool-owned) file copied verbatim into every adapter. */
export interface SharedFile {
  /** Repo-relative POSIX path under the canonical references/ or scripts/ root. */
  sourcePath: string;
  /** POSIX file mode: 0o644 for references, 0o755 for scripts (03 §3.6). */
  mode: number;
}

/** Everything discovery extracts from the canonical source for one build. */
export interface DiscoveryResult {
  /** Skills, sorted by POSIX sourcePath. */
  skills: SkillRecord[];
  /** Agents, sorted by POSIX sourcePath. */
  agents: AgentRecord[];
  /** Commands, sorted by POSIX sourcePath. */
  commands: CommandRecord[];
  /** Shared references/ tree, sorted by POSIX path. */
  sharedRefs: SharedFile[];
  /** Shared scripts/ tree, sorted by POSIX path. */
  sharedScripts: SharedFile[];
}

/** Stable ascending sort on a `sourcePath` field (UTF-16 code-unit order). */
function bySourcePath<T extends { sourcePath: string }>(a: T, b: T): number {
  return a.sourcePath < b.sourcePath ? -1 : a.sourcePath > b.sourcePath ? 1 : 0;
}

/** Repo-relative POSIX path for an absolute path (POSIX-normalized separators). */
function toPosixRelative(repoRoot: string, abs: string): string {
  return relative(repoRoot, abs).split(sep).join("/");
}

/**
 * Read a canonical file as UTF-8 with `\n`-normalized newlines (03 §3.2).
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

/** Recursively list every regular file under `absRoot`, confined to it. */
function walkFiles(absRoot: string): string[] {
  const out: string[] = [];
  const stack: string[] = [absRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = confinePath(absRoot, join(dir, entry.name));
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        out.push(abs);
      }
    }
  }
  return out;
}

/**
 * Walk a shared tree, returning sorted SharedFile entries with deterministic modes
 * (03 §3.6). References → 0o644; scripts → 0o755. A missing root yields []
 * (a repo may have no shared references/scripts).
 */
function collectSharedTree(absRoot: string, repoRoot: string, isScript: boolean): SharedFile[] {
  if (!existsSync(absRoot)) return [];
  const out: SharedFile[] = walkFiles(absRoot).map((abs) => ({
    sourcePath: toPosixRelative(repoRoot, abs),
    mode: isScript ? 0o755 : 0o644,
  }));
  out.sort(bySourcePath);
  return out;
}

/**
 * Collect a skill's owned `references/` and `scripts/` subdirectories (03 §3.3),
 * returning repo-relative POSIX paths sorted ascending. Both subdirs are optional.
 */
function collectOwnedTree(skillDir: string, repoRoot: string): string[] {
  const out: string[] = [];
  for (const sub of ["references", "scripts"]) {
    const absSub = confinePath(skillDir, join(skillDir, sub));
    if (existsSync(absSub) && statSync(absSub).isDirectory()) {
      for (const abs of walkFiles(absSub)) {
        out.push(toPosixRelative(repoRoot, abs));
      }
    }
  }
  out.sort();
  return out;
}

/** Parse a skill (03 §3.3): SKILL.md + TQ-3 metadata split + owned refs/scripts. */
function parseSkill(entry: ToolEntry, roots: ResolvedRoots): SkillRecord {
  const sourcePath = entry.source;
  const sourceAbs = confinePath(roots.repoRoot, sourcePath);
  // The canonical skill `source` is the skill directory `<source>/` (02 §2.3 / item
  // 021); the cross-check enforces that shape. For backward compatibility a source
  // that already points at `SKILL.md` is accepted as-is.
  const skillDir =
    existsSync(sourceAbs) && statSync(sourceAbs).isDirectory() ? sourceAbs : dirname(sourceAbs);
  const absPath =
    existsSync(sourceAbs) && statSync(sourceAbs).isDirectory()
      ? join(sourceAbs, "SKILL.md")
      : sourceAbs;
  const { frontmatter, body } = parseFrontmatter(
    readCanonicalText(absPath, sourcePath),
    sourcePath,
  );

  // name: required, MUST equal the parent directory name and the manifest entry (TQ-4).
  const name = frontmatter.get("name");
  if (typeof name !== "string" || name.length === 0) {
    throw new MalformedFrontmatterError(`${sourcePath}: missing or non-string 'name'`, sourcePath);
  }
  const dirName = basename(skillDir); // skills/<dirName>/SKILL.md
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

  const description = frontmatter.get("description") ?? "";
  if (typeof description !== "string") {
    throw new MalformedFrontmatterError(`${sourcePath}: 'description' is not a string`, sourcePath);
  }

  // metadata = ALL remaining frontmatter beyond name/description, in source order (TQ-3, §4).
  const metadata = new Map<string, unknown>();
  for (const [k, v] of frontmatter) {
    if (k !== "name" && k !== "description") metadata.set(k, v);
  }

  const ownRefs = collectOwnedTree(skillDir, roots.repoRoot);

  // Internally a skill's sourcePath always names the SKILL.md file (even when the
  // manifest entry points at the skill directory), so downstream consumers like
  // skillVerbatimRecords can derive the skill root by stripping the filename.
  return {
    name,
    description,
    metadata,
    body,
    ownRefs,
    sourcePath: toPosixRelative(roots.repoRoot, absPath),
  };
}

/** Parse an agent (03 §3.4): system-prompt body + ordered claudeKeys. */
function parseAgent(entry: ToolEntry, roots: ResolvedRoots): AgentRecord {
  const sourcePath = entry.source;
  const absPath = confinePath(roots.repoRoot, sourcePath);
  const { frontmatter, body } = parseFrontmatter(
    readCanonicalText(absPath, sourcePath),
    sourcePath,
  );

  const name = frontmatter.get("name");
  if (typeof name !== "string" || name.length === 0) {
    throw new MalformedFrontmatterError(`${sourcePath}: missing or non-string 'name'`, sourcePath);
  }
  const stem = basename(absPath, ".md");
  if (name !== stem || name !== entry.name) {
    throw new MalformedFrontmatterError(
      `${sourcePath}: name '${name}' != file stem '${stem}' / manifest entry '${entry.name}'`,
      sourcePath,
    );
  }

  const description = frontmatter.get("description") ?? "";
  if (typeof description !== "string") {
    throw new MalformedFrontmatterError(`${sourcePath}: 'description' is not a string`, sourcePath);
  }

  const claudeKeys = new Map<string, unknown>();
  for (const [k, v] of frontmatter) {
    if (k !== "name" && k !== "description") claudeKeys.set(k, v);
  }

  return { name, description, claudeKeys, body, sourcePath };
}

/** Parse a slash command (03 §3.5): argument-hint split out, rest is the prompt. */
function parseCommand(entry: ToolEntry, roots: ResolvedRoots): CommandRecord {
  const sourcePath = entry.source;
  const absPath = confinePath(roots.repoRoot, sourcePath);
  const { frontmatter, body } = parseFrontmatter(
    readCanonicalText(absPath, sourcePath),
    sourcePath,
  );

  const name = frontmatter.get("name");
  if (typeof name !== "string" || name.length === 0) {
    throw new MalformedFrontmatterError(`${sourcePath}: missing or non-string 'name'`, sourcePath);
  }
  const stem = basename(absPath, ".md");
  if (name !== stem || name !== entry.name) {
    throw new MalformedFrontmatterError(
      `${sourcePath}: name '${name}' != file stem '${stem}' / manifest entry '${entry.name}'`,
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

/**
 * Read every canonical artifact named by the manifest into in-memory records
 * (03 §3.1). Manifest-driven for skills/agents/commands; shared references/scripts
 * are walked from disk. All output arrays are sorted by POSIX sourcePath.
 *
 * @param manifest - The validated manifest (`02-manifest-and-config.md`).
 * @param roots - Absolute canonical roots resolved from `manifest.config`.
 * @returns Sorted record arrays + shared file lists.
 * @throws {SourceNotFoundError} a tool's `source` does not exist on disk.
 * @throws {MalformedFrontmatterError} a canonical file has bad/missing frontmatter.
 * @throws {PathEscapeError} a `source` resolves outside the canonical roots.
 */
export function discover(manifest: Manifest, roots: ResolvedRoots): DiscoveryResult {
  const skills: SkillRecord[] = [];
  const agents: AgentRecord[] = [];
  const commands: CommandRecord[] = [];
  const manifestRefs: SharedFile[] = [];
  const manifestScripts: SharedFile[] = [];

  for (const entry of manifest.tools) {
    switch (entry.type) {
      case "skill":
        skills.push(parseSkill(entry, roots));
        break;
      case "agent":
        agents.push(parseAgent(entry, roots));
        break;
      case "command":
        commands.push(parseCommand(entry, roots));
        break;
      case "reference":
      case "script": {
        // Explicitly-registered shared file: must exist (SourceNotFoundError if not).
        const absPath = confinePath(roots.repoRoot, entry.source);
        if (!existsSync(absPath)) {
          throw new SourceNotFoundError(`${entry.source}: source not found`, entry.source);
        }
        const isScript = entry.type === "script";
        const target = isScript ? manifestScripts : manifestRefs;
        for (const abs of statSync(absPath).isDirectory() ? walkFiles(absPath) : [absPath]) {
          target.push({
            sourcePath: toPosixRelative(roots.repoRoot, abs),
            mode: isScript ? 0o755 : 0o644,
          });
        }
        break;
      }
    }
  }

  skills.sort(bySourcePath);
  agents.sort(bySourcePath);
  commands.sort(bySourcePath);

  // Shared references/scripts trees walked from disk (REQ-TOOLS-04), merged with
  // any explicitly-registered manifest entries; de-duplicated by sourcePath.
  const sharedRefs = mergeShared(
    collectSharedTree(roots.referencesDir, roots.repoRoot, false),
    manifestRefs,
  );
  const sharedScripts = mergeShared(
    collectSharedTree(roots.scriptsDir, roots.repoRoot, true),
    manifestScripts,
  );

  return { skills, agents, commands, sharedRefs, sharedScripts };
}

/** Merge two SharedFile lists, de-duplicating by sourcePath, sorted ascending. */
function mergeShared(a: SharedFile[], b: SharedFile[]): SharedFile[] {
  const byPath = new Map<string, SharedFile>();
  for (const f of [...a, ...b]) {
    if (!byPath.has(f.sourcePath)) byPath.set(f.sourcePath, f);
  }
  return [...byPath.values()].sort(bySourcePath);
}
