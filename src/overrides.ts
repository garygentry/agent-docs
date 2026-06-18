import { readdirSync, readFileSync, statSync } from "node:fs";
import { sep } from "node:path";

import type { EmittedFile, Target } from "./model.js";
import type { ResolvedRoots } from "./config.js";
import { confinePath } from "./paths.js";

/**
 * Override loading and file-level overlay (05 §2/§3).
 *
 * Authors supply per-target overrides under `overrides/<target>/<relpath>`,
 * outside `adapters/`. Each override REPLACES the matching emitted file
 * whole-file (no section merge, no provenance header). Distinguishability
 * (V-005) is structural: a committed `adapters/<target>/<relpath>` is
 * author-sourced iff an `overrides/<target>/<relpath>` exists. A stale override
 * (no emitted counterpart) is deliberately non-fatal — collected, never thrown
 * (05 §3.3).
 */

// ---------------------------------------------------------------------------
// Override-set types (05 §2.1 — internal to this module, not part of 00)
// ---------------------------------------------------------------------------

/** One loaded override file, addressed by target + bundle-relative path. */
export interface OverrideFile {
  /** Target bundle this override belongs to. */
  target: Target;
  /** Bundle-relative POSIX path; matches the EmittedFile.relpath it replaces. */
  relpath: string;
  /** Adapter-root-relative path: `<target>/<relpath>`. The applyOverrides key. */
  adapterRelpath: string;
  /** Verbatim file contents (UTF-8). No provenance header is added. */
  content: string;
  /** POSIX mode read from the override file (0o644 docs / 0o755 scripts). */
  mode: number;
}

/** The full override overlay loaded from overrides/<target>/ for all targets. */
export interface OverrideSet {
  /** Keyed by adapter-root-relative path (`<target>/<relpath>`) for O(1) overlay. */
  byAdapterPath: Map<string, OverrideFile>;
}

/** Outcome of overlaying overrides onto the emitted file set. */
export interface OverlayResult {
  /** The overlaid file set: emitted files with overridden ones replaced. */
  files: EmittedFile[];
  /** Adapter-relative paths that were replaced by an override (EmitResult.overridden). */
  overridden: string[];
  /** Override paths pointing at a path the emitter no longer emits (non-fatal). */
  staleOverrides: string[];
}

/** Stable POSIX byte-order comparator for deterministic output (05 §6). */
const sortPosix = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Recursively collect every regular file under `dir`, returning each path
 * relative to `baseRoot` in POSIX form. Each resolved path is confined to
 * `baseRoot` (REQ-SEC-01). Directory entries are visited in a stable POSIX sort
 * so load order — and therefore error ordering — is deterministic (05 §3.1).
 */
function walkFiles(dir: string, baseRoot: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    sortPosix(a.name, b.name),
  );
  const out: string[] = [];
  for (const entry of entries) {
    const childAbs = confinePath(baseRoot, `${dir}/${entry.name}`);
    if (entry.isDirectory()) {
      out.push(...walkFiles(childAbs, baseRoot));
    } else if (entry.isFile()) {
      out.push(childAbs);
    }
  }
  return out;
}

/**
 * Load the entire overrides/ tree into an {@link OverrideSet}.
 *
 * Walks `overridesDir/<target>/**` for each configured target, in a stable POSIX
 * sort, reading each regular file verbatim. Every resolved read path is confined
 * to `overridesDir` via {@link confinePath} (REQ-SEC-01); a path escaping that
 * root throws {@link PathEscapeError}. A missing `overridesDir` (or a missing
 * per-target subdir) is NOT an error — it yields an empty overlay (REQ-EMIT-05:
 * overrides are optional). File modes are read from disk so an executable
 * override preserves `0o755`.
 *
 * @param roots   Resolved absolute roots (see {@link ResolvedRoots}, 05 §7).
 * @param targets Configured targets, in `TARGET_ORDER` (00 §5). Subdirs for
 *                targets not in this list are ignored (not loaded, not stale).
 * @returns The loaded overlay; `byAdapterPath` keyed by `<target>/<relpath>`.
 * @throws  {PathEscapeError} if any override path resolves outside `overridesDir`.
 */
export function loadOverrides(roots: ResolvedRoots, targets: Target[]): OverrideSet {
  const overridesDir = roots.overridesDir;
  const byAdapterPath = new Map<string, OverrideFile>();

  for (const target of targets) {
    const targetRoot = confinePath(overridesDir, target);
    let stat;
    try {
      stat = statSync(targetRoot);
    } catch {
      continue; // missing per-target subdir — not an error
    }
    if (!stat.isDirectory()) continue;

    for (const absPath of walkFiles(targetRoot, overridesDir)) {
      // Bundle-relative POSIX path (relative to overrides/<target>/).
      const relpath = absPath.slice(targetRoot.length + 1).split(sep).join("/");
      const adapterRelpath = `${target}/${relpath}`;
      byAdapterPath.set(adapterRelpath, {
        target,
        relpath,
        adapterRelpath,
        content: readFileSync(absPath, "utf8"),
        mode: statSync(absPath).mode & 0o777,
      });
    }
  }

  return { byAdapterPath };
}

/**
 * Overlay an {@link OverrideSet} onto the transform output (REQ-EMIT-04).
 *
 * For each emitted file whose `relpath` matches an override, the override's
 * content + mode REPLACE the emitted file (whole-file replace, no provenance
 * header). Each replaced path is collected into `overridden`. Any override with
 * no matching emitted file is **stale**: it is collected into `staleOverrides`
 * and the build CONTINUES — a stale override is a non-fatal warning, never a
 * thrown error (05 §3.3). Inputs are not mutated; a new `files` array is returned.
 *
 * Output ordering is deterministic: `files`, `overridden`, and `staleOverrides`
 * are all returned in stable POSIX sort (REQ-EMIT-06; 05 §6).
 *
 * @param files     The full emitted file set from all target transforms (04).
 * @param overrides The overlay from {@link loadOverrides}.
 * @returns Overlaid files plus `overridden` and `staleOverrides` lists.
 */
export function applyOverrides(files: EmittedFile[], overrides: OverrideSet): OverlayResult {
  const emittedByPath = new Map(files.map((f) => [f.relpath, f]));
  const overridden: string[] = [];
  const staleOverrides: string[] = [];

  // Detect stale overrides: an override with no emitted counterpart (non-fatal).
  for (const [adapterPath] of overrides.byAdapterPath) {
    if (!emittedByPath.has(adapterPath)) staleOverrides.push(adapterPath);
  }

  // Overlay: replace each matching emitted file with the override verbatim.
  const result: EmittedFile[] = files.map((f) => {
    const ov = overrides.byAdapterPath.get(f.relpath);
    if (!ov) return f;
    overridden.push(f.relpath);
    return { relpath: f.relpath, content: ov.content, mode: ov.mode };
  });

  result.sort((a, b) => sortPosix(a.relpath, b.relpath));
  overridden.sort(sortPosix);
  staleOverrides.sort(sortPosix);
  return { files: result, overridden, staleOverrides };
}
