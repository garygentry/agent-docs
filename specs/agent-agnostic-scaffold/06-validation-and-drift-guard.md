# 06 — Validation & Drift Guard

The validation stack that keeps committed adapters honest: the **drift guard**
(`src/driftguard.ts`, the P0 CI gate), per-target **schema validation**, the
sample-tool **golden snapshots**, and the **coverage report** (`src/report.ts`,
`adapters/GENERATION-REPORT.md`). This is the last line of defense behind the
emitter — it never produces adapter content, only verifies it.

All shared types used here are defined in `00-core-definitions.md` and are **not
redefined**: `DriftEntry`, `DriftError`, `ReportModel`, `TargetCoverage`,
`EmitResult`, `DropRecord`, `VerbatimRecord`, `Target`, `TARGET_ORDER`,
`PROVENANCE`, `REGEN_CMD`. The build/staging pipeline this guard reuses
(`emit`, `publish`, the `*.tmp-<pid>` staging dir, override overlay producing
`overridden` / `staleOverrides`) is defined in
`05-overrides-publish-determinism.md`.

## Requirement Coverage

| REQ ID        | Requirement                                                                                         | Section                  |
| ------------- | --------------------------------------------------------------------------------------------------- | ------------------------ |
| REQ-VALID-01  | Drift guard re-emits from canonical (overrides merged) and fails on mismatch; runnable locally + CI | 2, 2.2, 2.3              |
| REQ-VALID-02  | Drift guard fails the build on drift                                                                | 2.3, 2.5                 |
| REQ-VALID-03  | Per-target schema validation of emitted aggregate manifests                                         | 4                        |
| REQ-VALID-04  | Golden-file snapshot tests scoped to the sample skill                                               | 5                        |
| REQ-VALID-05  | Per-target coverage / capability report                                                             | 3                        |
| REQ-EMIT-08   | Orphan committed adapters detected (no canonical source)                                            | 2.2 (kind `orphan`), 2.4 |
| REQ-OBS-01    | Human-readable per-run summary (targets/tools/fallbacks/skips)                                      | 3                        |
| REQ-OBS-02    | Drift output identifies which files differ AND how                                                  | 2.2, 2.5                 |
| CON-05        | Drift guard runs in CI and gates the build                                                          | 2.3, 6                   |
| SC-03         | Emit twice → zero diff; `--check` clean                                                             | 2, Verification          |
| SC-04         | Hand-edit outside override slot → drift fail                                                        | 2.2, 2.4                 |
| SC-05a        | Removing a tool → orphan detected, drift fail                                                       | 2.2, 2.4                 |
| SC-06 / SC-08 | Coverage report + schema/golden checks pass                                                         | 3, 4, 5                  |

## 1. Module map

| File                                            | Responsibility                                                                                      | Section |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------- |
| `src/driftguard.ts`                             | `driftCheck(manifest, roots)`: re-emit + set/content diff → `DriftEntry[]`; throw `DriftError`      | 2       |
| `src/report.ts`                                 | `buildReport(result)` → `ReportModel`; `renderReport(model)` → `adapters/GENERATION-REPORT.md` body | 3       |
| `src/targets/codex.ts`, `src/targets/gemini.ts` | own each aggregate manifest's emit (`04`); this doc adds the post-emit schema check                 | 4       |
| `src/cli.ts`                                    | `build --check` wiring: call `driftCheck`, catch `DriftError`, print, exit non-zero                 | 2.5     |
| `src/test/__golden__/<target>/…`                | checked-in expected sample-skill output (asserted by `08-testing-strategy.md`)                      | 5       |

`driftCheck` and `buildReport`/`renderReport` are pure library functions; only
`src/cli.ts` reads `process.exit`. `driftCheck` is re-exported from
`src/index.ts` (`01-architecture-layout.md` §5) for programmatic reuse
(REQ-REUSE-01).

## 2. Drift guard — `src/driftguard.ts` (REQ-VALID-01/02, CON-05)

### 2.1 Contract

The drift guard answers one question: **does the committed `adapters/` tree match
exactly what a fresh build from the current canonical source + overrides would
emit?** It MUST re-emit with overrides merged **identically to a normal build**
(`05-overrides-publish-determinism.md` §3, `applyOverrides`), so a legitimate
override file is never flagged as drift (REQ-VALID-01, SC-05). It MUST detect
**both** content differences and **orphan** files — committed adapters with no
corresponding emitted file (REQ-EMIT-08, SC-05a) — not only content drift.

It NEVER mutates `adapters/`: it builds into a throwaway staging dir, reads
committed bytes, compares in memory, and deletes the staging dir.

### 2.2 Comparison — set-based + content-based (REQ-OBS-02)

The comparison produces one `DriftEntry` per offending file. `DriftEntry.kind`
(`00-core-definitions.md` §3.6) is the structured "how" REQ-OBS-02 requires:

| `kind`    | Meaning                                                        | Detection                            | Maps to                                    |
| --------- | -------------------------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| `content` | path exists in both trees, bytes differ                        | byte-compare `Buffer`s               | SC-04 (hand-edit outside override)         |
| `orphan`  | committed in `adapters/` but absent from the fresh emit        | set difference `committed \ emitted` | REQ-EMIT-08, SC-05a (tool removed/renamed) |
| `missing` | emitted by a fresh build but absent from committed `adapters/` | set difference `emitted \ committed` | a never-committed / deleted adapter file   |

The file set on the **emitted** side is the post-overlay set: `EmitResult.files`
after `applyOverrides` (overridden paths included — they are real emitted bytes).
The **committed** side is the set of **guarded roots**: every regular file under
`roots.adaptersDir` PLUS the repo-root `.claude-plugin/` directory, each walked in
stable POSIX order. `GENERATION-REPORT.md` (under `adaptersDir`, emitted by
`report.ts` §3) and the `.claude-plugin/{plugin,marketplace}.json` manifests
(repo-root, emitted by `plugin.ts`/`07-packaging-and-sample-tool.md`) are emitted
files too, so they participate in the diff — a stale committed report or plugin
manifest is itself drift.

> Guarded-root note: because `.claude-plugin/` lives at the repo root and not under
> `adaptersDir` (see `01-architecture-layout.md` §2), the drift guard MUST walk both
> roots. Each emitted file's key is its path relative to the guarded root it belongs
> to (`adaptersDir`-relative for adapter files, repo-relative `.claude-plugin/...`
> for the plugin manifests), so the two key spaces do not collide.

Both sides are keyed by `adaptersDir`-relative POSIX path. Comparison is **byte
exact** (no newline normalization beyond what the emitter already applied — the
emitter writes `\n` verbatim, `05` §4.2), because byte-stability (REQ-EMIT-06) is
the guarantee being verified. Staging-dir paths (`*.tmp-<pid>`) are excluded from
the committed walk (`.gitignore`d, `01-architecture-layout.md` §2).

### 2.3 Signature

```typescript
import type { Manifest } from "./model.js";
import type { ResolvedRoots } from "./config.js"; // 05 §7.1
import { DriftEntry, DriftError } from "./model.js";

/**
 * Drift guard (REQ-VALID-01/02, CON-05). Re-emits the COMPLETE adapter tree from
 * the current canonical source + overrides into a throwaway staging dir — using
 * the exact same emit + override-overlay pipeline as a normal build
 * (`emit`, `applyOverrides`; 05) so legitimate overrides never read as drift —
 * then compares the fresh emit against the committed `adapters/` tree.
 *
 * The comparison is set-based AND content-based:
 *   - `content`: a path present in both trees whose bytes differ (SC-04).
 *   - `orphan` : a committed adapter file with no emitted counterpart — a stale
 *                file left by a removed/renamed tool (REQ-EMIT-08, SC-05a).
 *   - `missing`: an emitted file absent from committed `adapters/`.
 *
 * NEVER mutates `adapters/`. The staging dir is always removed before return,
 * including on the throw path. Returns the (possibly empty) drift list; the
 * caller decides whether to throw — but {@link assertNoDrift} / the CLI turn a
 * non-empty result into a `DriftError`.
 *
 * @param manifest Validated manifest (00 §2.4); single source of the tool set
 *                 (REQ-DISC-02) so the guard checks exactly what emit produced.
 * @param roots    Resolved absolute roots (05 §7.1); `adaptersDir` is the
 *                 committed tree to compare against.
 * @returns Drift entries in stable POSIX order, `[]` when the trees match.
 * @throws {ManifestValidationError | MalformedFrontmatterError | SourceNotFoundError | PathEscapeError}
 *         propagated from the underlying `emit` — a build that cannot even run is
 *         a fatal error, not a drift verdict (distinct exit semantics, §2.5).
 */
export function driftCheck(manifest: Manifest, roots: ResolvedRoots): DriftEntry[];

/**
 * Convenience: run {@link driftCheck} and throw `DriftError` (00 §4) carrying the
 * `DriftEntry[]` if any drift is found. Used by `cli.ts` for `build --check`.
 *
 * @throws {DriftError} when `driftCheck` returns a non-empty list (REQ-VALID-02).
 */
export function assertNoDrift(manifest: Manifest, roots: ResolvedRoots): void;
```

### 2.4 Implementation sketch

```typescript
import { emit } from "./emit.js"; // (manifest, roots) => EmitResult (05/04)
import { applyOverrides, loadOverrides } from "./overrides.js"; // 05 §3
import { newStagingDir } from "./publish.js"; // 05 §4.2 — fresh <adaptersDir>.tmp-<pid>
import { walkFilesPosix, readBytes } from "./paths.js"; // 05 §7 confined helpers
import { rmSync } from "node:fs";

const sortPosix = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function driftCheck(manifest: Manifest, roots: ResolvedRoots): DriftEntry[] {
  // 1. Fresh emit + identical override overlay (REQ-VALID-01). Bytes only —
  //    we do NOT publish; we diff in memory. emit() already produces the
  //    post-transform file set; overlay matches a real build (05 §3).
  const result: EmitResult = emit(manifest, roots);
  const overrides = loadOverrides(roots, manifest.config.targets);
  const { files } = applyOverrides(result.files, overrides);

  // 2. Emitted side: adaptersDir-relative POSIX path -> content bytes.
  const emitted = new Map<string, string>();
  for (const f of files) emitted.set(f.relpath, f.content);

  // 3. Committed side: walk the real adapters/ tree (confined read, 05 §7).
  //    *.tmp-<pid> staging dirs are excluded by walkFilesPosix.
  const committed = new Map<string, string>();
  for (const rel of walkFilesPosix(roots.adaptersDir)) {
    committed.set(rel, readBytes(roots.adaptersDir, rel));
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

export function assertNoDrift(manifest: Manifest, roots: ResolvedRoots): void {
  const entries = driftCheck(manifest, roots);
  if (entries.length > 0) {
    throw new DriftError(renderDriftMessage(entries), entries);
  }
}
```

> Note on staging: the sketch above diffs `emit`'s in-memory file set directly
> and does not need a staging dir on disk, which is the simplest byte-exact
> comparison and avoids filesystem round-trips. If an implementation prefers to
> materialize the fresh emit (to reuse `publish`'s confinement walk verbatim,
> mirroring feature-forge's `diff -r` against a staging dir at
> `/home/gary/workspace/feature-forge/scripts/build-adapters.py:1323` `check()`),
> it MUST `newStagingDir` → write all files → walk both trees → `rmSync(staging,
{ recursive: true, force: true })` in a `finally`, so the staging dir is removed
> on every path including the throw path. Either approach MUST produce the same
> `DriftEntry[]`; the in-memory form is preferred because it has no `diff`
> external-tool dependency (feature-forge's `check()` returns exit 2 when `diff`
> is absent — an environment fault we avoid by comparing in TS).

### 2.5 Remediation message & CLI exit (REQ-OBS-02, REQ-VALID-02)

`renderDriftMessage` formats a per-file, per-kind block plus a single remediation
line, so an author can fix the source quickly (REQ-OBS-02):

```typescript
/**
 * Render the human-facing drift report carried by `DriftError.message`. One line
 * per entry, grouped by kind, plus the single remediation line. Deterministic
 * (entries already POSIX-sorted, §2.4).
 */
function renderDriftMessage(entries: DriftEntry[]): string {
  const byKind = (k: DriftEntry["kind"]) =>
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
```

`src/cli.ts` wires `build --check` (`01-architecture-layout.md` §3, the
`build:check` package script) as:

```typescript
// inside cli.ts, command === "build" && flags.check
try {
  assertNoDrift(manifest, roots); // §2.3
  process.exit(0); // SC-03 clean tree
} catch (err) {
  if (err instanceof DriftError) {
    console.error(err.message); // §2.5 per-file + remediation (REQ-OBS-02)
    process.exit(1); // drift verdict (REQ-VALID-02)
  }
  if (err instanceof EmitterError) {
    // build couldn't run — fatal, distinct
    console.error(`${err.code}: ${err.message}`);
    process.exit(1);
  }
  throw err; // generator bug → stack trace
}
```

`build:check` is both the local command and the **last step of the `gate`
script** (`01-architecture-layout.md` §3), so the drift guard runs in CI and gates
the build (CON-05, REQ-VALID-02). A clean tree exits 0 (SC-03); any drift exits 1.

## 3. Coverage report — `src/report.ts` (REQ-VALID-05, REQ-OBS-01)

Every build (not `--check`) writes `adapters/GENERATION-REPORT.md` from the
`EmitResult`. The report is itself a committed, emitted file and is therefore
**drift-guarded** by §2 — a stale report fails `build:check`.

### 3.1 Build the model

```typescript
import type { EmitResult } from "./model.js";
import { ReportModel, TargetCoverage, Target, TARGET_ORDER } from "./model.js";

/**
 * Fold an `EmitResult` (00 §3.4) into the `ReportModel` (00 §3.5) that the report
 * renders. Tallies per target are derived from the result's `files`, `drops`,
 * `overridden`, and `verbatim`, so the report and the emitted bytes can never
 * disagree (single source). Surfaces exactly REQ-OBS-01's required data: targets
 * emitted, tools processed, fallbacks applied, items skipped.
 *
 * Per-target counts:
 *   - emitted    = distinct emitted files for that target (post-overlay file set)
 *   - fallback   = `drops` with kind "fallback" for that target (REQ-EMIT-03)
 *   - skipped    = `drops` with kind "skipped" for that target
 *   - overridden = `overridden` paths under `<target>/`
 *   - verbatim   = `verbatim` records under `<target>/`
 *
 * @param result The whole-tree emit result (all targets).
 * @returns A fully-populated `ReportModel`; `perTarget` has an entry for EVERY
 *          configured target in `TARGET_ORDER` order, even with zero activity.
 */
export function buildReport(result: EmitResult): ReportModel;
```

`buildReport` derives `toolsProcessed` from the manifest tool set carried into the
emit (each `{ name, type }`); `staleOverrides` is threaded through from
`applyOverrides` (`05-overrides-publish-determinism.md` §3) into the `EmitResult`
or passed alongside it — the stale-override warning list lives in the report, not
in an error (`00-core-definitions.md` §4 note; tech-spec §3.4/§7).

### 3.2 Render the markdown

```typescript
/**
 * Render the committed `adapters/GENERATION-REPORT.md` body from a `ReportModel`.
 *
 * Layout (all sections deterministic — fixed `TARGET_ORDER`, POSIX-sorted rows):
 *   1. Provenance: Form B HTML comment (`PROVENANCE.htmlComment()`, 00 §5) — the
 *      report is frontmatter-less markdown, so it gets the body-top comment.
 *   2. `## Summary` — tools processed (count + name/type list).
 *   3. `## Coverage by target` — one row per target: emitted / fallback /
 *      skipped / overridden / verbatim (the `TargetCoverage` tally).
 *   4. `## Dropped & fallback constructs` — every `DropRecord`, grouped by target
 *      in `TARGET_ORDER`, rows sorted by (source, construct); empty groups state
 *      "_No dropped constructs._" (REQ-EMIT-03 — no silent drops).
 *   5. `## Overridden files` — `overridden` paths (author content; no provenance).
 *   6. `## Copied verbatim (no provenance header)` — `verbatim` records, the
 *      files transported byte-for-byte (REQ-EMIT-06) that intentionally carry no
 *      header.
 *   7. `## Stale overrides` — `staleOverrides` (non-fatal warning; tech-spec §7).
 *
 * Ends with a single trailing newline. Byte-stable (REQ-EMIT-06) so the report
 * passes the drift guard on an unchanged build.
 *
 * @param model The folded report model.
 * @returns The full report text, `\n`-normalized, ending in one `\n`.
 */
export function renderReport(model: ReportModel): string;
```

The "Copied verbatim" section mirrors feature-forge's
`_render_verbatim_copies_section`
(`/home/gary/workspace/feature-forge/scripts/build-adapters.py:1115`): it documents
the provenance of header-less files, satisfying REQ-OBS-01's intent that every
artifact's provenance is discoverable even when it carries no inline header.

### 3.3 Example output (excerpt)

```markdown
<!-- GENERATED — DO NOT EDIT. Regenerate: bun run build -->

# Adapter Generation Report

## Summary

3 tools processed: `pr-helper` (skill), `triage` (agent), `summarize` (command).

## Coverage by target

| Target  | Emitted | Fallback | Skipped | Overridden | Verbatim |
| ------- | ------- | -------- | ------- | ---------- | -------- |
| claude  | 7       | 0        | 0       | 0          | 2        |
| codex   | 6       | 1        | 0       | 1          | 2        |
| copilot | 5       | 1        | 1       | 0          | 2        |
| cursor  | 6       | 0        | 1       | 0          | 2        |
| gemini  | 6       | 1        | 0       | 0          | 2        |

## Dropped & fallback constructs

### codex

| Source                  | Construct       | Reason                                                         |
| ----------------------- | --------------- | -------------------------------------------------------------- |
| `commands/summarize.md` | `command:codex` | No native slash-command construct; emitted as instruction doc. |

### copilot

| Source                  | Construct         | Reason                                                              |
| ----------------------- | ----------------- | ------------------------------------------------------------------- |
| `agents/triage.md`      | `agent.model`     | Structural agent key not representable on copilot (TQ-2).           |
| `commands/summarize.md` | `command:copilot` | No native slash-command construct; skipped (no aggregate manifest). |

## Stale overrides

_None._
```

## 4. Per-target schema validation (REQ-VALID-03)

Each emitted **aggregate manifest** is validated against that target's expected
shape **after emit, before publish**. Only two targets emit an aggregate manifest
(tech-spec §3.7, §5.2 transform table):

| Target                    | Aggregate manifest      | Schema source                                                                                             | This-version behavior                                                                                                                                                                                                  |
| ------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| codex                     | `agents/openai.yaml`    | OpenAI/Codex agent-manifest YAML shape — **not published as a machine schema** by the vendor at spec time | Validate against a **local Zod shape** (`CodexManifestSchema`) derived from the `ManifestEntry` set: a YAML mapping of `agents` each with `{ name, description }`. WARNING: vendor schema unconfirmed; see note below. |
| gemini                    | `gemini-extension.json` | Gemini extension reference (`docs/extensions/reference.md`) — has a defined JSON shape                    | Validate against a **local Zod shape** (`GeminiExtensionSchema`): `{ name, version, contextFileName?, … }` plus one entry per skill.                                                                                   |
| claude / copilot / cursor | none                    | —                                                                                                         | **Skip with note** — these targets emit per-file documents, no aggregate manifest, so there is no manifest schema to validate (recorded explicitly, not silently).                                                     |

### 4.1 Signature

```typescript
import { z } from "zod";
import type { EmittedFile } from "./model.js";
import { ManifestValidationError, Target } from "./model.js";

/** Local Zod shape for codex `agents/openai.yaml` (REQ-VALID-03). */
export const CodexManifestSchema: z.ZodType;
/** Local Zod shape for `gemini-extension.json` (REQ-VALID-03). */
export const GeminiExtensionSchema: z.ZodType;

/**
 * Validate the emitted aggregate manifest for a target against its local Zod
 * shape. Targets with no aggregate manifest (claude/copilot/cursor) are a no-op
 * (return immediately — the "skip with note" case is logged once).
 *
 * @param target  The target whose aggregate manifest to validate.
 * @param files   That target's emitted files; the aggregate manifest is located
 *                by its well-known relpath (`agents/openai.yaml` /
 *                `gemini-extension.json`).
 * @throws {ManifestValidationError} if the emitted manifest fails its Zod shape —
 *         this is an EMITTER bug (the transform produced an invalid manifest),
 *         fatal, exits non-zero before publish.
 */
export function validateTargetManifest(target: Target, files: EmittedFile[]): void;
```

> WARNING: Neither Codex nor Gemini ships a versioned machine-readable schema we
> can vendor at spec time. The codex `agents/openai.yaml` shape and the
> `gemini-extension.json` shape are reconstructed from the targets' published
> docs (Codex agent manifest docs; Gemini `docs/extensions/reference.md`,
> referenced in `04-transforms.md`/tech-spec §3.7). These local Zod shapes MUST
> be revisited if a vendor schema appears. This is a self-consistency check (the
> emitter's own output matches the shape we believe each target requires), not a
> guarantee against vendor schema changes — verify the field set against current
> target docs before implementing.

Validation runs inside the emit pipeline for `build`, and (because it is
deterministic over the same input) the drift guard's re-emit (§2) implicitly
re-validates on `build --check` as well.

## 5. Golden snapshots — sample skill only (REQ-VALID-04)

Golden snapshots are a **focused transform-regression test** scoped to the **one
MVP sample skill** (tech-spec §3.7, OQ-04), **complementary to**, not a duplicate
of, the whole-tree drift guard (§2). The drift guard already verifies the entire
committed tree byte-for-byte; goldens exist to catch unintended transform changes
in isolation on a small, reviewable surface — so a transform regression surfaces
as a tight, readable diff against `src/test/__golden__/<target>/…` rather than as
a large whole-tree drift.

- Scope: emit ONLY the sample skill (a minimal manifest with that one
  `ToolEntry`) and assert **byte-equality** of each target's output against the
  checked-in `src/test/__golden__/<target>/…` fixtures.
- This is NOT a parallel copy of every tool's output — only the sample skill's
  per-target surface (the user decision, tech-spec §3.7).
- Ownership: the golden **fixtures, the sample-skill content, and the vitest
  assertion harness** are specified and owned by **`08-testing-strategy.md`**
  (§ golden snapshot). This document only fixes the _role_ of goldens within the
  validation stack (focused regression vs. whole-tree drift) and their byte-exact
  semantics. See `08-testing-strategy.md` for the fixture layout, the sample-skill
  definition, and the `vitest` cases.
- The sample skill's expected output for all four targets + claude is the
  SC-02/SC-08 end-to-end proof; once those goldens are checked in, SC-08 becomes
  testable (PRD SC-08).

## 6. Where this runs

| Trigger            | Command                       | Stack pieces exercised                                    |
| ------------------ | ----------------------------- | --------------------------------------------------------- |
| Local author build | `bun run build`               | schema validation (§4), report write (§3)                 |
| Local drift check  | `bun run build:check`         | drift guard (§2) — re-emit + diff, schema (§4 implicitly) |
| Unit/golden tests  | `bun run test` (`vitest run`) | golden snapshots (§5, owned by `08`)                      |
| CI gate (CON-05)   | `bun run gate`                | `… && build:check` last — drift guard gates the build     |

The `gate` script (`01-architecture-layout.md` §3) is the CI bar; its terminal
`build:check` step is the CON-05 mandate that the drift guard runs in CI and fails
the build on drift (REQ-VALID-02).

## Dependencies

Must be implemented first:

- `00-core-definitions.md` — `DriftEntry`, `DriftError`, `EmitterError`,
  `ManifestValidationError`, `ReportModel`, `TargetCoverage`, `EmitResult`,
  `DropRecord`, `VerbatimRecord`, `Target`, `TARGET_ORDER`, `PROVENANCE`,
  `REGEN_CMD`, `Manifest`.
- `01-architecture-layout.md` — module layout (`src/driftguard.ts`,
  `src/report.ts`), the `build:check` / `gate` package scripts, `src/index.ts`
  barrel re-exporting `driftCheck`.
- `04-transforms.md` — `emit`/the per-target transforms producing `EmitResult`,
  `drops`, `verbatim`, and the aggregate manifests this doc schema-validates; the
  codex/gemini aggregate-manifest emit owned there.
- `05-overrides-publish-determinism.md` — `emit(manifest, roots) => EmitResult`,
  `loadOverrides` / `applyOverrides` (the override overlay the guard re-applies),
  `ResolvedRoots` (`§7.1`), `newStagingDir`, the confined `walkFilesPosix` /
  `readBytes` path helpers, and the `*.tmp-<pid>` staging convention.
- `08-testing-strategy.md` — owns the golden fixtures, the sample skill, and the
  drift/orphan/determinism vitest cases that exercise this stack (§5).

## Verification

- [ ] On a clean, freshly-built tree, `bun run build:check` exits 0 and
      `driftCheck` returns `[]` (SC-03; emit twice → zero diff).
- [ ] Hand-editing a committed `adapters/<target>/…` file (outside any override
      slot) → `driftCheck` returns one `DriftEntry { kind: "content" }`;
      `build:check` exits 1 with the per-file + remediation message (SC-04,
      REQ-OBS-02). Reverting makes it pass.
- [ ] Removing a tool's `ToolEntry` from the manifest, then running `build:check`
      WITHOUT rebuilding → the tool's still-committed adapter files surface as
      `DriftEntry { kind: "orphan" }` and exit 1 (REQ-EMIT-08, SC-05a).
- [ ] A declared override under `overrides/<target>/<relpath>` survives a build
      and `build:check` reports NO drift for that path (the guard re-applies the
      overlay; REQ-VALID-01, SC-05).
- [ ] `DriftError.entries` is populated and `DriftError.message` lists each file
      and its `kind` plus the single `bun run build` remediation line (REQ-OBS-02).
- [ ] `build:check` exits **1** for drift and for a fatal emit error, and exits 0
      only on a matching tree; a generator bug propagates as a stack trace (not an
      exit-1 verdict).
- [ ] `adapters/GENERATION-REPORT.md` regenerates byte-identically on an unchanged
      build (passes its own drift guard) and lists tools processed, per-target
      emitted/fallback/skipped/overridden/verbatim counts, every `DropRecord`, the
      "Copied verbatim" section, and `staleOverrides` (REQ-VALID-05, REQ-OBS-01).
- [ ] `validateTargetManifest("codex", …)` and `("gemini", …)` accept the
      emitter's own aggregate manifests and reject a corrupted one with
      `ManifestValidationError`; claude/copilot/cursor are a documented no-op
      (REQ-VALID-03).
- [ ] Golden snapshots for the sample skill (owned by `08-testing-strategy.md`)
      assert byte-equality per target and are scoped to that one skill, not the
      whole tree (REQ-VALID-04).
- [ ] `bun run gate` runs `build:check` as its final step and fails on drift
      (CON-05, REQ-VALID-02).
