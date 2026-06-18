import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { ZodIssue } from "zod";

import { Manifest, type ToolEntry } from "./model.js";
import {
  ManifestValidationError,
  MalformedFrontmatterError,
  SourceNotFoundError,
} from "./errors.js";

/**
 * Manifest loading, Zod validation, and the TQ-4 manifest↔source cross-check
 * (02-manifest-and-config.md §2). `loadManifest` is the single entry point that
 * turns the on-disk `tools.manifest.json` into a trusted in-memory `Manifest`,
 * feeding BOTH the emitter and the drift guard so the tool set cannot diverge
 * (REQ-DISC-02).
 *
 * NOTE: `src/config.ts` (resolveConfig/ResolvedConfig) and `src/frontmatter.ts`
 * (the shared parser) are owned by later backlog items (004 / 006). Until they
 * land, this module resolves `source` paths relative to the manifest's repo root
 * itself and extracts the frontmatter `name` with a minimal local reader. When
 * 006 lands, the frontmatter-agreement branch should switch to that parser to
 * keep `name` extraction identical to discovery (see 02 §2.3 WARNING).
 */

/** Format Zod issues into the stable string[] carried by ManifestValidationError. */
function formatIssues(issues: ZodIssue[]): string[] {
  return issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`);
}

/**
 * Read, parse, validate, and cross-check tools.manifest.json. This is the single
 * source of truth feeding BOTH the emitter and the drift guard (REQ-DISC-02).
 *
 * Steps, in order:
 *   1. Read the file (ENOENT/unreadable → ManifestValidationError, not a raw fs error).
 *   2. JSON.parse (SyntaxError → ManifestValidationError with the parse message).
 *   3. Manifest.safeParse — on failure throw ManifestValidationError carrying the
 *      formatted Zod issue list (00 §4). Config defaults are applied by Zod.
 *   4. crossCheckSources — confirm each tool's `source` exists and, where present,
 *      its on-disk frontmatter `name` agrees with the manifest (§2.3, TQ-4).
 *
 * @param manifestPath - Repo-relative or absolute path to tools.manifest.json.
 * @param repoRoot - Absolute repo root; all `source` paths resolve relative to it.
 *                   Defaults to the directory containing the manifest file.
 * @returns The validated, cross-checked manifest (config defaults applied).
 * @throws {ManifestValidationError} File missing, unparseable JSON, Zod failure,
 *         or a source/frontmatter cross-check mismatch.
 * @throws {SourceNotFoundError} A tool's `source` path does not exist on disk.
 * @throws {MalformedFrontmatterError} A source's frontmatter is present but unparseable.
 */
export function loadManifest(manifestPath: string, repoRoot?: string): Manifest {
  const absManifest = isAbsolute(manifestPath)
    ? manifestPath
    : resolve(process.cwd(), manifestPath);
  const root = repoRoot ? resolve(repoRoot) : dirname(absManifest);

  let raw: string;
  try {
    raw = readFileSync(absManifest, "utf-8");
  } catch {
    throw new ManifestValidationError(
      `tools.manifest.json not found at ${absManifest}`,
      [],
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ManifestValidationError(`invalid JSON: ${msg}`, []);
  }

  const result = Manifest.safeParse(parsed);
  if (!result.success) {
    throw new ManifestValidationError(
      `tools.manifest.json failed validation (${result.error.issues.length} issue(s))`,
      formatIssues(result.error.issues),
    );
  }
  const manifest = result.data;

  crossCheckSources(manifest, root);
  return manifest;
}

/**
 * For each tool in the manifest, verify against the canonical source on disk
 * (02 §2.3, resolves TQ-4):
 *   (a) the `source` path EXISTS (else SourceNotFoundError);
 *   (b) the on-disk shape matches the declared `type` (skill → a directory with
 *       SKILL.md; agent/command → a single file);
 *   (c) for markdown-bearing types (skill/agent/command), the source's frontmatter
 *       `name` (WHERE PRESENT) EQUALS the manifest `name` (else ManifestValidationError).
 *
 * `script`/`reference` entries are checked for existence only.
 *
 * @param manifest - The Zod-validated manifest.
 * @param repoRoot - Absolute repo root; `source` resolves relative to it.
 */
export function crossCheckSources(manifest: Manifest, repoRoot: string): void {
  manifest.tools.forEach((tool, index) => {
    const label = `tools[${index}]`;
    const absSource = resolve(repoRoot, tool.source);

    switch (tool.type) {
      case "skill": {
        if (!existsSync(absSource) || !statSync(absSource).isDirectory()) {
          throw new SourceNotFoundError(
            `${label}.source "${tool.source}" is not a directory (type "skill" requires <source>/SKILL.md)`,
            tool.source,
          );
        }
        const skillMd = join(absSource, "SKILL.md");
        if (!existsSync(skillMd)) {
          throw new SourceNotFoundError(
            `${label}.source "${tool.source}" has no SKILL.md (required for type "skill")`,
            tool.source,
          );
        }
        checkFrontmatterName(tool, label, skillMd, `${tool.source}/SKILL.md`);
        break;
      }
      case "agent":
      case "command": {
        if (!existsSync(absSource)) {
          throw new SourceNotFoundError(
            `${label}.source "${tool.source}" does not exist`,
            tool.source,
          );
        }
        if (!statSync(absSource).isFile()) {
          throw new ManifestValidationError(
            `${label}.source "${tool.source}" must be a single file for type "${tool.type}"`,
            [`${label}.source: expected a file for type "${tool.type}"`],
          );
        }
        checkFrontmatterName(tool, label, absSource, tool.source);
        break;
      }
      case "script":
      case "reference": {
        if (!existsSync(absSource)) {
          throw new SourceNotFoundError(
            `${label}.source "${tool.source}" does not exist`,
            tool.source,
          );
        }
        break;
      }
    }
  });
}

/**
 * Enforce the §2.3 rule (b) frontmatter-name agreement when the source declares
 * a `name`. An absent frontmatter `name` is not an error (it can be inferred from
 * the path basename). Throws ManifestValidationError on disagreement.
 */
function checkFrontmatterName(
  tool: ToolEntry,
  label: string,
  absFile: string,
  displaySource: string,
): void {
  const content = readFileSync(absFile, "utf-8");
  const fmName = readFrontmatterName(content, displaySource);
  if (fmName !== undefined && fmName !== tool.name) {
    throw new ManifestValidationError(
      `${label}.name "${tool.name}": source ${displaySource} frontmatter name is "${fmName}" — they must match`,
      [`${label}.name: "${tool.name}" != source frontmatter name "${fmName}"`],
    );
  }
}

/**
 * Minimal frontmatter `name` reader. Splits a leading `---`-fenced YAML block and
 * returns the top-level `name:` value, or undefined when no frontmatter / no name.
 * Throws MalformedFrontmatterError on an unterminated frontmatter fence.
 *
 * Intentionally narrow — full order-preserving parsing is owned by 006
 * (`src/frontmatter.ts`); this only needs the scalar `name`.
 */
function readFrontmatterName(content: string, sourcePath: string): string | undefined {
  if (!content.startsWith("---")) return undefined;
  const rest = content.slice(3);
  // Frontmatter opens with `---` followed by a newline.
  if (!/^\r?\n/.test(rest)) return undefined;
  const closeMatch = rest.match(/\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!closeMatch || closeMatch.index === undefined) {
    throw new MalformedFrontmatterError(
      `unterminated frontmatter block in ${sourcePath}`,
      sourcePath,
    );
  }
  const block = rest.slice(0, closeMatch.index);
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^name:\s*(.+?)\s*$/);
    if (m && m[1] !== undefined) {
      return stripQuotes(m[1]);
    }
  }
  return undefined;
}

/** Strip a single layer of matching single/double quotes from a scalar value. */
function stripQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}
