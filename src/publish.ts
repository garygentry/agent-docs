import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type { ResolvedRoots } from "./config.js";
import type { EmittedFile, VerbatimRecord } from "./model.js";
import { confinePath } from "./paths.js";

/**
 * Atomic publish + stale cleanup (05 §4/§5).
 *
 * {@link publish} writes the final overlaid adapter set to disk atomically: it
 * stages the WHOLE file set into a fresh `*.tmp-<pid>` sibling dir, then swaps it
 * onto `adaptersDir` with a single `fs.rename`. A failed run never leaves a
 * partial or mixed tree (fail-intact); the whole-subtree swap means any committed
 * file absent from the new set vanishes automatically (stale cleanup, REQ-EMIT-08).
 * Every write is confined to the staging root via {@link confinePath}
 * (REQ-SEC-01). Output is byte-stable across identical inputs (REQ-EMIT-05/06):
 * no `Date.now()`, no nondeterministic ordering — only the staging-dir *name*
 * carries the pid, and that is never published.
 */

/** Stable POSIX byte-order comparator for deterministic write ordering (05 §6). */
const sortPosix = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Create a fresh, empty staging dir `<adaptersRoot>.tmp-<pid>/`, removing any
 * leftover from a crashed prior run. The `.tmp-<pid>` suffix is gitignored
 * (01 §2) and is NEVER published as-is — it is always renamed onto `adaptersRoot`
 * or removed. The pid suffix avoids collisions between concurrent invocations and
 * never appears in committed file content (05 §6 rule 2).
 *
 * @param adaptersRoot Resolved `adapters/` path.
 * @returns Absolute path of the new staging dir.
 */
export function newStagingDir(adaptersRoot: string): string {
  const staging = `${adaptersRoot}.tmp-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  return staging;
}

/**
 * Write one file under `stagingRoot`, sandbox-checked (05 §4.2).
 *
 * Resolves `stagingRoot/<relpath>`, asserts it stays inside `stagingRoot` via
 * {@link confinePath} (REQ-SEC-01), creates parent dirs, writes `content` as
 * UTF-8, and applies `mode`. Content is written verbatim — no trailing-newline
 * fixups, no reflow (determinism, 05 §6).
 *
 * @throws {PathEscapeError} if `relpath` escapes `stagingRoot`.
 */
export function writeConfined(
  stagingRoot: string,
  relpath: string,
  content: string,
  mode: number,
): void {
  const dest = confinePath(stagingRoot, relpath);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, content);
  chmodSync(dest, mode);
}

/**
 * Atomically publish the full overlaid file set + verbatim copies into `adaptersDir`.
 *
 * Algorithm (05 §4.3):
 *   1. Create a fresh sibling staging dir via {@link newStagingDir}.
 *   2. Write EVERY {@link EmittedFile} and every {@link VerbatimRecord} into the
 *      staging dir, each path confined to the staging root (REQ-SEC-01). Verbatim
 *      records are copied byte-for-byte from their canonical source under
 *      `repoRoot` with NO provenance header.
 *   3. Atomic swap: move the existing `adaptersDir` aside to a `.prev` sibling
 *      (if present), `fs.rename` the staging dir onto `adaptersDir`, then remove
 *      the `.prev` tree. The rename replaces the WHOLE subtree, so any committed
 *      file not in the new set vanishes automatically (stale cleanup, REQ-EMIT-08).
 *
 * Fail-intact: if any step before the final rename throws, the staging dir is
 * removed and `adaptersDir` is left exactly as it was — no partial tree
 * (REQ-EMIT-05). Staging and `adaptersDir` are siblings under the repo root, so
 * the rename is atomic (same filesystem).
 *
 * @param files    The overlaid EmittedFile[] from {@link applyOverrides}.
 * @param verbatim Skill-owned / shared reference copies (04 §4.6), no provenance.
 * @param roots    Resolved absolute roots; `adaptersDir` is the write root,
 *                 `repoRoot` is the verbatim source read root.
 * @throws {PathEscapeError} if any path resolves outside its confinement root.
 */
export function publish(
  files: EmittedFile[],
  verbatim: VerbatimRecord[],
  roots: ResolvedRoots,
): void {
  const adaptersRoot = roots.adaptersDir;
  const staging = newStagingDir(adaptersRoot);

  try {
    // Stable order is not required for correctness (each write is independent),
    // but it makes any error report deterministic (05 §6 rule 1).
    for (const file of [...files].sort((a, b) => sortPosix(a.relpath, b.relpath))) {
      writeConfined(staging, file.relpath, file.content, file.mode);
    }

    for (const record of [...verbatim].sort((a, b) => sortPosix(a.relpath, b.relpath))) {
      // Read the canonical source verbatim and copy it byte-for-byte. No
      // provenance header is added (05 §4 / 04 §4.6).
      const sourceAbs = confinePath(roots.repoRoot, record.sourcePath);
      const content = readFileSync(sourceAbs, "utf8");
      const mode = statSync(sourceAbs).mode & 0o777;
      writeConfined(staging, record.relpath, content, mode);
    }
  } catch (err) {
    rmSync(staging, { recursive: true, force: true }); // fail-intact
    throw err;
  }

  const backup = `${adaptersRoot}.tmp-${process.pid}.prev`;
  if (existsSync(adaptersRoot)) renameSync(adaptersRoot, backup); // move old aside
  renameSync(staging, adaptersRoot); // atomic publish of the whole subtree
  if (existsSync(backup)) rmSync(backup, { recursive: true, force: true });
}
