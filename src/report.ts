import type { EmitResult, Manifest, TargetCoverage } from "./model.js";
import { PROVENANCE, TARGET_ORDER, Target } from "./model.js";
import type { ReportModel } from "./model.js";

/**
 * Coverage report (06 §3, REQ-VALID-05, REQ-OBS-01).
 *
 * `buildReportModel` folds an `EmitResult` + `Manifest` into the `ReportModel`
 * (00 §3.5); `renderReport` renders `adapters/GENERATION-REPORT.md` from it. Both
 * are pure and fully deterministic — fixed `TARGET_ORDER`, POSIX-sorted rows, no
 * `Date.now()` — so the report is byte-stable (REQ-EMIT-06) and survives the drift
 * guard (06 §2) on an unchanged build.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Stable POSIX-path comparator (matches the rest of the emitter). */
const sortPosix = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Does an adapter-root-relative path belong to `<target>/`? */
function underTarget(relpath: string, target: Target): boolean {
  return relpath === target || relpath.startsWith(`${target}/`);
}

// ---------------------------------------------------------------------------
// 1. Build the model (06 §3.1)
// ---------------------------------------------------------------------------

/**
 * Fold an `EmitResult` and its `Manifest` into the `ReportModel` the report
 * renders. Per-target tallies are derived from the result's `files`, `drops`,
 * `overridden`, and `verbatim` (all keyed by `<target>/<relpath>`), so the report
 * and the emitted bytes can never disagree (single source). Surfaces exactly
 * REQ-OBS-01's data: targets emitted, tools processed, fallbacks applied, items
 * skipped.
 *
 * `perTarget` always has an entry for EVERY target in `TARGET_ORDER`, even with
 * zero activity. `staleOverrides` is threaded through from `applyOverrides`
 * (05 §3) — it is not carried on `EmitResult`, so it is passed alongside it
 * (default `[]`); it is a non-fatal warning list, never an error (00 §4 note).
 *
 * @param emitResult The whole-tree emit result (all targets), post-overlay.
 * @param manifest The validated manifest whose tools were processed.
 * @param staleOverrides Override paths with no emitted counterpart (05 §3.3).
 * @returns A fully-populated, deterministic `ReportModel`.
 */
export function buildReportModel(
  emitResult: EmitResult,
  manifest: Manifest,
  staleOverrides: string[] = [],
): ReportModel {
  const toolsProcessed = manifest.tools.map((t) => ({ name: t.name, type: t.type }));

  const perTarget = {} as Record<Target, TargetCoverage>;
  for (const target of TARGET_ORDER) {
    perTarget[target] = {
      emitted: emitResult.files.filter((f) => underTarget(f.relpath, target)).length,
      fallback: emitResult.drops.filter((d) => d.target === target && d.kind === "fallback").length,
      skipped: emitResult.drops.filter((d) => d.target === target && d.kind === "skipped").length,
      overridden: emitResult.overridden.filter((p) => underTarget(p, target)).length,
      verbatim: emitResult.verbatim.filter((v) => underTarget(v.relpath, target)).length,
    };
  }

  const drops = [...emitResult.drops].sort(
    (a, b) =>
      TARGET_ORDER.indexOf(a.target) - TARGET_ORDER.indexOf(b.target) ||
      sortPosix(a.source, b.source) ||
      sortPosix(a.construct, b.construct),
  );

  return {
    toolsProcessed,
    perTarget,
    drops,
    staleOverrides: [...staleOverrides].sort(sortPosix),
  };
}

// ---------------------------------------------------------------------------
// 2. Render the markdown (06 §3.2)
// ---------------------------------------------------------------------------

/**
 * Render the committed `adapters/GENERATION-REPORT.md` body from a `ReportModel`.
 *
 * Layout (all deterministic — fixed `TARGET_ORDER`, POSIX-sorted rows):
 *   1. Form B provenance HTML comment (`PROVENANCE.htmlComment()`, 00 §5).
 *   2. `## Summary` — tools processed (count + name/type list).
 *   3. `## Coverage by target` — one row per target: emitted / fallback /
 *      skipped / overridden / verbatim.
 *   4. `## Dropped & fallback constructs` — every `DropRecord`, grouped by target
 *      in `TARGET_ORDER`; `_No dropped constructs._` when none (REQ-EMIT-03).
 *   5. `## Stale overrides` — `staleOverrides` (non-fatal warning); `_None._`
 *      when empty.
 *
 * Ends with a single trailing newline. Byte-stable (REQ-EMIT-06).
 *
 * @param model The folded report model.
 * @returns The full report text, `\n`-normalized, ending in one `\n`.
 */
export function renderReport(model: ReportModel): string {
  const lines: string[] = [];

  lines.push(PROVENANCE.htmlComment(), "", "# Adapter Generation Report", "");

  // 2. Summary
  lines.push("## Summary", "");
  if (model.toolsProcessed.length === 0) {
    lines.push("0 tools processed.");
  } else {
    const list = model.toolsProcessed.map((t) => `\`${t.name}\` (${t.type})`).join(", ");
    const noun = model.toolsProcessed.length === 1 ? "tool" : "tools";
    lines.push(`${model.toolsProcessed.length} ${noun} processed: ${list}.`);
  }
  lines.push("");

  // 3. Coverage by target
  lines.push("## Coverage by target", "");
  lines.push("| Target | Emitted | Fallback | Skipped | Overridden | Verbatim |");
  lines.push("|--------|---------|----------|---------|------------|----------|");
  for (const target of TARGET_ORDER) {
    const c = model.perTarget[target];
    lines.push(
      `| ${target} | ${c.emitted} | ${c.fallback} | ${c.skipped} | ${c.overridden} | ${c.verbatim} |`,
    );
  }
  lines.push("");

  // 4. Dropped & fallback constructs
  lines.push("## Dropped & fallback constructs", "");
  if (model.drops.length === 0) {
    lines.push("_No dropped constructs._", "");
  } else {
    for (const target of TARGET_ORDER) {
      const rows = model.drops.filter((d) => d.target === target);
      if (rows.length === 0) continue;
      lines.push(`### ${target}`, "");
      lines.push("| Source | Construct | Reason |");
      lines.push("|--------|-----------|--------|");
      for (const d of rows) {
        lines.push(`| \`${d.source}\` | \`${d.construct}\` | ${d.reason} |`);
      }
      lines.push("");
    }
  }

  // 5. Stale overrides
  lines.push("## Stale overrides", "");
  if (model.staleOverrides.length === 0) {
    lines.push("_None._");
  } else {
    for (const p of model.staleOverrides) lines.push(`- \`${p}\``);
  }
  lines.push("");

  return lines.join("\n");
}
