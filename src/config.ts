import { isAbsolute, relative, resolve, sep } from "node:path";

import type { EmitterConfig } from "./model.js";
import { PathEscapeError } from "./errors.js";

/**
 * Absolute roots derived from {@link EmitterConfig} (00 §2.3) by resolving each
 * repo-relative POSIX directory against `repoRoot` (05 §7.1).
 *
 * Downstream modules (discover 007, emit 013, publish 015, drift guard 016) read
 * paths ONLY from here — never from hardcoded constants — so the emitter is
 * path-agnostic and reusable (REQ-REUSE-01). The `targets` list is NOT part of
 * this shape; it is read directly from the validated `Manifest.config.targets`.
 */
export interface ResolvedRoots {
  /** Absolute repo root all other roots are confined within. */
  repoRoot: string;
  /** Canonical skill source root (absolute). */
  skillsDir: string;
  /** Canonical agent source root (absolute). */
  agentsDir: string;
  /** Canonical slash-command source root (absolute). */
  commandsDir: string;
  /** Shared references root (absolute). */
  referencesDir: string;
  /** Shared scripts root (absolute). */
  scriptsDir: string;
  /** Read root for override slots — the ONLY non-canonical read root (absolute). */
  overridesDir: string;
  /** Write root for the published adapter tree (absolute). */
  adaptersDir: string;
}

/**
 * Resolve `relDir` under `repoRoot` and assert it stays inside the repo.
 *
 * This is a read-time sanity gate on the configured roots (02 §3.2); it guarantees
 * the emitter cannot be pointed at, e.g., `overridesDir: "../../etc"`. The repo root
 * itself is permitted (defensive). Per-file write confinement is enforced separately
 * by `confinePath` in src/paths.ts (05 §7).
 *
 * @throws {PathEscapeError} if the resolved directory escapes `repoRoot`.
 */
function confineRoot(repoRoot: string, relDir: string, label: string): string {
  const abs = isAbsolute(relDir) ? relDir : resolve(repoRoot, relDir);
  const rel = relative(repoRoot, abs);
  if (rel === "") return abs; // the repo root itself is allowed (defensive)
  if (rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
    throw new PathEscapeError(
      `config.${label} resolves outside the repository: ${relDir} → ${abs}`,
      abs,
    );
  }
  return abs;
}

/**
 * Resolve an {@link EmitterConfig}'s relative directory strings into absolute roots
 * under `repoRoot`, sanity-checking that each stays inside the repo (REQ-SEC-01).
 *
 * Every path the emitter uses flows from here (REQ-REUSE-01); this is the ONLY place
 * config strings become absolute. The actual write-time confinement guard lives in
 * src/paths.ts (05 §7); here we only validate that the configured roots are in-repo.
 *
 * @param config - The validated EmitterConfig (defaults already applied by Zod).
 * @param repoRoot - Absolute repo root; every directory resolves relative to it.
 * @returns Fully resolved, repo-confined roots.
 * @throws {PathEscapeError} A configured directory resolves outside `repoRoot`.
 */
export function resolveConfig(config: EmitterConfig, repoRoot: string): ResolvedRoots {
  const root = resolve(repoRoot);
  return {
    repoRoot: root,
    skillsDir: confineRoot(root, config.skillsDir, "skillsDir"),
    agentsDir: confineRoot(root, config.agentsDir, "agentsDir"),
    commandsDir: confineRoot(root, config.commandsDir, "commandsDir"),
    referencesDir: confineRoot(root, config.referencesDir, "referencesDir"),
    scriptsDir: confineRoot(root, config.scriptsDir, "scriptsDir"),
    overridesDir: confineRoot(root, config.overridesDir, "overridesDir"),
    adaptersDir: confineRoot(root, config.adaptersDir, "adaptersDir"),
  };
}
