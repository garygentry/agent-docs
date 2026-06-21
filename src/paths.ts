import { resolve, sep } from "node:path";

import { PathEscapeError } from "./errors.js";

/**
 * Resolve `candidate` against `root` and assert the result stays inside `root`.
 *
 * Ports feature-forge's `allowed_root` guard (REQ-SEC-01, 05 §7). Used for EVERY
 * filesystem path the emitter touches: canonical-source reads, override reads,
 * staging writes, and post-swap `adapters/` paths. `confinePath` does lexical +
 * `path.resolve` normalization, which collapses `..` segments; callers that may
 * face symlinks should `fs.realpath` before confining.
 *
 * @param root      The allowed root (absolute or relative — resolved here). One of:
 *                  canonical source dirs, `overridesDir`, the staging dir, or
 *                  `adaptersDir`.
 * @param candidate A path (absolute or relative to `root`) to confine.
 * @returns The resolved absolute path, guaranteed to be `root` or under it.
 * @throws  {PathEscapeError} if the resolved path is neither `root` nor a
 *          descendant of `root`.
 *
 * @example
 * confinePath("/repo/adapters.tmp-7", "codex/skills/foo/foo.md");
 * // → "/repo/adapters.tmp-7/codex/skills/foo/foo.md"
 * confinePath("/repo/overrides", "cursor/../../etc/passwd"); // throws PathEscapeError
 */
export function confinePath(root: string, candidate: string): string {
  const rootResolved = resolve(root);
  const resolved = resolve(rootResolved, candidate);
  const withSep = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;
  if (resolved !== rootResolved && !resolved.startsWith(withSep)) {
    throw new PathEscapeError(
      `refusing to access path outside ${rootResolved}: ${resolved}`,
      resolved,
    );
  }
  return resolved;
}

/**
 * Alias of {@link confinePath} matching the 05 §7 / item-spec naming
 * (`resolveWithin(root, relpath)`): resolve `relpath` within `root`, throwing
 * {@link PathEscapeError} if it escapes. Identical semantics — provided so callers
 * may use whichever name reads best at the call site.
 */
export const resolveWithin = confinePath;
