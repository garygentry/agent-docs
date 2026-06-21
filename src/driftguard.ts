import { readdirSync, readFileSync } from "node:fs";
import { sep } from "node:path";

import type { ResolvedRoots } from "./config.js";
import { DriftError } from "./errors.js";
import { emit } from "./emit.js";
import type { EmitIdentity } from "./emit.js";
import type { DriftEntry, EmittedFile, Manifest } from "./model.js";
import { REGEN_CMD } from "./model.js";
import { applyOverrides, loadOverrides } from "./overrides.js";
import { confinePath } from "./paths.js";

/**
 * Drift guard (06 §2, REQ-VALID-01/02, CON-05).
 *
 * Answers one question: does the committed adapter tree match exactly what a fresh
 * build from the current canonical source + overrides would emit? It re-emits with
 * the SAME pipeline as a normal build ({@link emit} + {@link applyOverrides}, 05)
 * so a legitimate override is never flagged as drift, then compares the fresh emit
 * against the committed files on disk under `adaptersDir` AND the repo-root
 * `.claude-plugin/` directory (06 §2.2). It NEVER mutates `adapters/`: it reads
 * committed bytes and compares in memory.
 */

/** Stable POSIX byte-order comparator for deterministic output (05 §6). */
const sortPosix = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Recursively collect every regular file under `dir`, returning each path relative
 * to `baseRoot` in POSIX form, in stable POSIX sort. Each resolved path is confined
 * to `baseRoot` (REQ-SEC-01). A missing `dir` yields `[]` — a never-built tree is
 * simply "nothing committed", not an error.
 */
function walkRelposix(dir: string, baseRoot: string): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // dir does not exist — nothing committed under this root
  }
  entries.sort((a, b) => sortPosix(a.name, b.name));
  const out: string[] = [];
  for (const entry of entries) {
    const childAbs = confinePath(baseRoot, `${dir}/${entry.name}`);
    if (entry.isDirectory()) {
      out.push(...walkRelposix(childAbs, baseRoot));
    } else if (entry.isFile()) {
      out.push(
        childAbs
          .slice(baseRoot.length + 1)
          .split(sep)
          .join("/"),
      );
    }
  }
  return out;
}

/**
 * Re-emit the COMPLETE adapter tree in memory and diff it against the committed
 * tree (06 §2). Both sides are keyed by `adaptersDir`-relative POSIX path; the
 * repo-root `.claude-plugin/` manifests are keyed by their repo-relative
 * `.claude-plugin/...` path (the key spaces never collide, 06 §2.2 guarded-root
 * note). The comparison is set-based AND content-based:
 *   - `content`: a path present in both trees whose bytes differ (SC-04).
 *   - `orphan` : a committed file with no emitted counterpart (REQ-EMIT-08, SC-05a).
 *   - `missing`: an emitted file absent from the committed tree.
 *
 * @param manifest      Validated manifest (003); the single source of the tool set.
 * @param roots         Resolved absolute roots (004); `adaptersDir` is the committed
 *                      tree to compare against, `repoRoot` anchors `.claude-plugin/`.
 * @param pluginFiles   Emitted `.claude-plugin/{plugin,marketplace}.json` files
 *                      (07 §3), threaded in by the CLI once plugin packaging (019)
 *                      runs; each `relpath` is repo-relative (`.claude-plugin/...`).
 *                      Omitted by callers that do not package the plugin.
 * @param identity      Aggregate-manifest identity (07 §3.2) threaded into `emit`.
 * @returns Drift entries in stable POSIX order; `[]` when the trees match.
 * @throws  Propagates fatal emit errors (ManifestValidationError, etc.) — a build
 *          that cannot run is a fatal error, not a drift verdict (06 §2.5).
 */
export function driftCheck(
  manifest: Manifest,
  roots: ResolvedRoots,
  pluginFiles: EmittedFile[] = [],
  identity?: EmitIdentity,
): DriftEntry[] {
  // 1. Fresh emit + identical override overlay (REQ-VALID-01). Bytes only — we
  //    diff in memory, we do NOT publish.
  const result = emit(manifest, roots, identity);
  const overrides = loadOverrides(roots, manifest.config.targets);
  const { files } = applyOverrides(result.files, overrides);

  // 2. Emitted side: adaptersDir-relative POSIX path -> content bytes. Includes
  //    the transform output, the verbatim copies (publish writes these too, so
  //    they must participate or they would read as orphans), and the plugin
  //    manifests under .claude-plugin/.
  const emitted = new Map<string, string>();
  for (const f of files) emitted.set(f.relpath, f.content);
  for (const v of result.verbatim) {
    emitted.set(v.relpath, readFileSync(confinePath(roots.repoRoot, v.sourcePath), "utf8"));
  }
  for (const pf of pluginFiles) emitted.set(pf.relpath, pf.content);

  // 3. Committed side: walk the real adapters/ tree (keyed adaptersDir-relative)
  //    plus the repo-root .claude-plugin/ tree (keyed `.claude-plugin/...`).
  const committed = new Map<string, string>();
  for (const rel of walkRelposix(roots.adaptersDir, roots.adaptersDir)) {
    committed.set(rel, readFileSync(confinePath(roots.adaptersDir, rel), "utf8"));
  }
  const pluginRoot = confinePath(roots.repoRoot, ".claude-plugin");
  for (const rel of walkRelposix(pluginRoot, roots.repoRoot)) {
    committed.set(rel, readFileSync(confinePath(roots.repoRoot, rel), "utf8"));
  }

  const entries: DriftEntry[] = [];
  // content + missing: every emitted path.
  for (const [rel, content] of emitted) {
    if (!committed.has(rel)) entries.push({ relpath: rel, kind: "missing" });
    else if (committed.get(rel) !== content) entries.push({ relpath: rel, kind: "content" });
  }
  // orphan: committed paths with no emitted counterpart (REQ-EMIT-08, SC-05a).
  for (const rel of committed.keys()) {
    if (!emitted.has(rel)) entries.push({ relpath: rel, kind: "orphan" });
  }

  entries.sort((a, b) => sortPosix(a.relpath, b.relpath));
  return entries;
}

/**
 * Render the human-facing drift report carried by `DriftError.message` (06 §2.5).
 * One line per entry, grouped by kind, plus a single remediation line.
 * Deterministic (entries already POSIX-sorted).
 */
export function renderDriftMessage(entries: DriftEntry[]): string {
  const byKind = (k: DriftEntry["kind"]): string[] =>
    entries.filter((e) => e.kind === k).map((e) => `  ${e.relpath}`);
  const blocks: string[] = [
    "Adapter drift detected — committed adapters/ do not match a fresh build:",
  ];
  const sections: Array<[DriftEntry["kind"], string]> = [
    ["content", "Content differs (hand-edited or stale emitted output):"],
    ["orphan", "Orphan files (no canonical source — remove or restore the tool):"],
    ["missing", "Missing files (emitted by build but not committed):"],
  ];
  for (const [kind, heading] of sections) {
    const rows = byKind(kind);
    if (rows.length) blocks.push("", heading, ...rows);
  }
  blocks.push("", `Remediation: run \`${REGEN_CMD}\` and commit the result.`);
  return blocks.join("\n");
}

/**
 * Convenience: run {@link driftCheck} and throw {@link DriftError} (00 §4) carrying
 * the `DriftEntry[]` if any drift is found. Used by `cli.ts` for `build --check`
 * (REQ-VALID-02).
 *
 * @throws {DriftError} when `driftCheck` returns a non-empty list.
 */
export function assertNoDrift(
  manifest: Manifest,
  roots: ResolvedRoots,
  pluginFiles: EmittedFile[] = [],
  identity?: EmitIdentity,
): void {
  const entries = driftCheck(manifest, roots, pluginFiles, identity);
  if (entries.length > 0) {
    throw new DriftError(renderDriftMessage(entries), entries);
  }
}
