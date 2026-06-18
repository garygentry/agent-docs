# 05 — Overrides, Atomic Publish & Determinism

How author-supplied per-target overrides are overlaid onto transform output, how
the resulting file set is published atomically with automatic stale cleanup, the
determinism guarantees that make the drift guard reliable, and the write/read
confinement that keeps the emitter from touching anything outside its sanctioned
roots.

This document owns three emitter modules from `01-architecture-layout.md`:
`src/overrides.ts`, `src/publish.ts`, and `src/paths.ts`. It consumes the
`EmittedFile[]` produced by the transforms (`04-transforms.md`) and feeds the
`overridden` / `staleOverrides` data into the report and drift guard
(`06-validation-and-drift-guard.md`). All shared types
(`EmittedFile`, `EmitResult`, `VerbatimRecord`, `PathEscapeError`, `YAML_OPTS`,
`TARGET_ORDER`) come from `00-core-definitions.md` and are **not** redefined here.

## Requirement Coverage

| REQ ID | Requirement | Section |
|--------|-------------|---------|
| REQ-EMIT-04 | Per-target override slots, deterministically distinguishable (V-005) | 2, 3 |
| REQ-EMIT-05 | Idempotent, safe rebuild; no manual cleanup; overrides preserved | 4, 6 |
| REQ-EMIT-06 | Byte-stable over canonical input **and** override contents | 6 |
| REQ-EMIT-08 | Stale adapter files auto-removed on rebuild (no orphans) | 5 |
| REQ-REL-01 | Determinism + idempotency as reliability backbone | 6 |
| REQ-SEC-01 | Read/write confinement; no writes outside adapter/build roots | 7 |
| REQ-OBS-01 / REQ-VALID-05 | `overridden` + `staleOverrides` feed the coverage report | 3 |

Cross-cutting decisions traced to tech-spec §3.4 (overrides), §3.6 (determinism /
publish / stale cleanup / write confinement), and §7 (stale-override = non-fatal).

## 1. Module responsibilities

| Module | Responsibility | Section |
|--------|----------------|---------|
| `src/paths.ts` | `confinePath` containment guard; resolve roots | 7 |
| `src/overrides.ts` | Load `overrides/<target>/` tree; overlay onto emitted files; compute `overridden` + `staleOverrides` | 2, 3 |
| `src/publish.ts` | Stage the full file set; atomic swap into `adapters/`; stale cleanup; fail-intact | 4, 5 |

Orchestration order inside `emit.ts` (`04-transforms.md`) is:
`discover → transform → loadOverrides → applyOverrides → publish`. `applyOverrides`
runs **after** all transforms have produced the per-target `EmittedFile[]`, so an
override always replaces a fully-formed emitted file or is recorded as stale.

## 2. Override model (REQ-EMIT-04, V-005)

Overrides live in `overrides/<target>/<relpath>`, **outside** `adapters/`
(`01-architecture-layout.md` §2). `<relpath>` is the path **relative to that
target's bundle** — i.e. it matches the `EmittedFile.relpath` the emitter would
otherwise write to `adapters/<target>/<relpath>`. Merge is **whole-file replace**
at file granularity (tech-spec §3.4; section-merge is out of scope, OQ-03 closed at
file level).

Distinguishability (V-005) is structural, not heuristic: a committed
`adapters/<target>/<relpath>` file is **author-sourced if and only if** an
`overrides/<target>/<relpath>` file exists. The drift guard
(`06-validation-and-drift-guard.md`) re-runs `loadOverrides` + `applyOverrides`
identically during `--check`, so the same file is reproduced byte-for-byte and
never reads as drift. Overridden files therefore carry **no provenance header**
(tech-spec §3.4, §5.3) — they are author content copied verbatim. The transform
layer applies provenance headers; `applyOverrides` runs after and replaces the
whole file, so any header the transform may have written is discarded along with
the emitted body.

### 2.1 Override-set types

These are internal to `src/overrides.ts` (not part of `00`'s shared surface).

```typescript
import type { EmittedFile, Target } from "./model.js";

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
```

> Note on the `EmittedFile.relpath` convention. Throughout this document an
> `EmittedFile.relpath` is **adapter-root-relative** (`<target>/<relpath>`, e.g.
> `cursor/skills/foo/foo.mdc`) — the same convention `04-transforms.md` emits and
> `publish` writes under `adaptersDir`. `OverrideFile.adapterRelpath` is built to
> match it exactly so overlay is a direct map lookup.

## 3. Loading & applying overrides

### 3.1 `loadOverrides`

```typescript
import type { Target } from "./model.js";
import { confinePath } from "./paths.js";

/**
 * Load the entire overrides/ tree into an {@link OverrideSet}.
 *
 * Walks `overridesDir/<target>/**` for each configured target, in a stable POSIX
 * sort, reading each regular file verbatim. Every resolved read path is confined
 * to `overridesDir` via {@link confinePath} (REQ-SEC-01); a path escaping that
 * root throws {@link PathEscapeError}. A missing `overridesDir` (or a missing
 * per-target subdir) is NOT an error — it yields an empty overlay (REQ-EMIT-05:
 * overrides are optional).
 *
 * @param roots   Resolved absolute roots (see {@link ResolvedRoots}, §7).
 * @param targets Configured targets, in `TARGET_ORDER` (00 §5). Subdirs for
 *                targets not in this list are ignored (not loaded, not stale).
 * @returns The loaded overlay; `byAdapterPath` keyed by `<target>/<relpath>`.
 * @throws  {PathEscapeError} if any override path resolves outside `overridesDir`.
 */
export function loadOverrides(roots: ResolvedRoots, targets: Target[]): OverrideSet;
```

Loading is read-only and side-effect free. File modes are read from disk so an
executable override (a shell helper) preserves `0o755`; everything else is `0o644`.
The walk uses the same stable POSIX sort as discovery (`03`) so load order — and
therefore any error ordering — is deterministic.

### 3.2 `applyOverrides`

```typescript
/** Outcome of overlaying overrides onto the emitted file set. */
export interface OverlayResult {
  /** The overlaid file set: emitted files with overridden ones replaced. */
  files: EmittedFile[];
  /** Adapter-relative paths that were replaced by an override (EmitResult.overridden). */
  overridden: string[];
  /** Override paths pointing at a path the emitter no longer emits (non-fatal). */
  staleOverrides: string[];
}

/**
 * Overlay an {@link OverrideSet} onto the transform output (REQ-EMIT-04).
 *
 * For each emitted file whose `relpath` matches an override, the override's
 * content + mode REPLACE the emitted file (whole-file replace, no provenance
 * header). Each replaced path is collected into `overridden`. Any override with
 * no matching emitted file is **stale**: it is collected into `staleOverrides`
 * and the build CONTINUES — a stale override is a non-fatal warning, never a
 * thrown error (tech-spec §7; see §3.3). Inputs are not mutated; a new
 * `files` array is returned.
 *
 * Output ordering is deterministic: `files` is returned sorted by `relpath`
 * (stable POSIX sort), and `overridden` / `staleOverrides` are sorted the same
 * way (REQ-EMIT-06; see §6).
 *
 * @param files     The full emitted file set from all target transforms (04).
 * @param overrides The overlay from {@link loadOverrides}.
 * @returns Overlaid files plus `overridden` and `staleOverrides` lists.
 */
export function applyOverrides(files: EmittedFile[], overrides: OverrideSet): OverlayResult;
```

`overridden` populates `EmitResult.overridden` (`00` §3.4) and the per-target
`overridden` tally in `ReportModel` (`00` §3.5). `staleOverrides` populates
`ReportModel.staleOverrides`. Both feed `06-validation-and-drift-guard.md`.

#### Reference implementation sketch

```typescript
export function applyOverrides(files: EmittedFile[], overrides: OverrideSet): OverlayResult {
  const emittedByPath = new Map(files.map((f) => [f.relpath, f]));
  const overridden: string[] = [];
  const staleOverrides: string[] = [];

  // Detect stale overrides: an override with no emitted counterpart.
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

  const sortPosix = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  result.sort((a, b) => sortPosix(a.relpath, b.relpath));
  overridden.sort(sortPosix);
  staleOverrides.sort(sortPosix);
  return { files: result, overridden, staleOverrides };
}
```

### 3.3 Stale override = non-fatal warning (resolved policy)

A stale override targets a path the emitter no longer emits — e.g. a tool was
renamed or removed from the manifest, so `overrides/cursor/skills/old-name/...`
no longer corresponds to any emitted file. Policy (tech-spec §3.4, §7): this is a
**warning, not a failure**. The build collects it into `staleOverrides`, emits a
non-fatal warning to stderr, and continues. There is deliberately **no**
`OverrideConflictError` (`00` §4 note).

This is symmetric with two sibling guarantees and is justified by them:

- **REQ-EMIT-08 (auto orphan cleanup):** emitted orphan files are removed
  automatically on rebuild (§5) rather than requiring the author to delete them.
  Treating a *stale override* as fatal would force exactly the manual cleanup that
  REQ-EMIT-08 abolishes for emitted output — the author would have to delete the
  override file before any build could succeed. Warn-and-continue keeps the two
  cleanup postures consistent.
- **REQ-EMIT-05 (no manual cleanup between runs):** a build against unchanged input
  must not require the author to first reconcile leftover override files. A stale
  override left over from a removed tool is precisely such leftover state.

The author still gets a loud signal (the warning + the `staleOverrides` section of
`GENERATION-REPORT.md`) and can delete the override at leisure. Note the
asymmetry with hand-edits to *emitted* files: those still fail the drift guard
(SC-04) because they are not in an override slot. The sanctioned escape hatch is
declaring an override (SC-05), and a *correctly placed* override never reads as
drift.

## 4. Atomic publish (REQ-EMIT-05)

`src/publish.ts` writes the final overlaid file set to disk. It never edits
`adapters/` in place. Instead it builds the **whole** file set into a fresh staging
dir, then swaps it into place with a single rename — so a failed run never leaves a
partial or mixed tree (fail-intact, tech-spec §3.6).

```typescript
import type { EmittedFile } from "./model.js";

/**
 * Atomically publish the full overlaid file set into `adaptersRoot`.
 *
 * Algorithm (tech-spec §3.6):
 *   1. Create a fresh sibling staging dir `<adaptersRoot>.tmp-<pid>/`.
 *   2. Write EVERY file in `files` into the staging dir, each path confined to
 *      the staging root via {@link confinePath} (REQ-SEC-01, §7). Parent dirs are
 *      created as needed; modes are applied from `EmittedFile.mode`.
 *   3. Atomic swap: move the existing `adaptersRoot` aside to a `.prev` sibling
 *      (if present), `fs.rename` the staging dir onto `adaptersRoot`, then remove
 *      the `.prev` tree. The rename replaces the WHOLE subtree, so any file not in
 *      `files` (a removed/renamed tool's orphan) vanishes automatically (REQ-EMIT-08).
 *
 * Fail-intact: if any step before the final rename throws, the staging dir is
 * removed and `adaptersRoot` is left exactly as it was — no partial tree
 * (REQ-EMIT-05). Staging and `adaptersRoot` MUST be on the same filesystem so the
 * rename is atomic; they are siblings under the repo root, which guarantees this.
 *
 * @param files        The overlaid EmittedFile[] from {@link applyOverrides}.
 * @param adaptersRoot Resolved absolute path of `adapters/` (config `adaptersDir`).
 * @throws {PathEscapeError} if any file path resolves outside the staging root.
 */
export function publish(files: EmittedFile[], adaptersRoot: string): void;
```

### 4.1 Staging-dir helper

```typescript
/**
 * Create a fresh, empty staging dir `<adaptersRoot>.tmp-<pid>/`, removing any
 * leftover from a crashed prior run. The `.tmp-<pid>` suffix is gitignored
 * (01 §2) and is NEVER published as-is — it is always renamed onto `adaptersRoot`
 * or removed. The pid suffix avoids collisions between concurrent invocations.
 *
 * @param adaptersRoot Resolved `adapters/` path.
 * @returns Absolute path of the new staging dir.
 */
function newStagingDir(adaptersRoot: string): string;
```

### 4.2 Confined single-file write

```typescript
/**
 * Write one EmittedFile under `stagingRoot`, sandbox-checked.
 *
 * Resolves `stagingRoot/<relpath>`, asserts it is inside `stagingRoot` via
 * {@link confinePath} (REQ-SEC-01), creates parent dirs, writes `content` as
 * UTF-8, and applies `mode`. Content is written verbatim — no trailing-newline
 * fixups, no reflow (determinism, §6).
 *
 * @throws {PathEscapeError} if `relpath` escapes `stagingRoot`.
 */
function writeConfined(stagingRoot: string, file: EmittedFile): void;
```

### 4.3 Reference swap sketch

```typescript
import { mkdirSync, writeFileSync, chmodSync, renameSync, rmSync, existsSync } from "node:fs";

export function publish(files: EmittedFile[], adaptersRoot: string): void {
  const staging = newStagingDir(adaptersRoot);
  try {
    // Stable order is not required for correctness here, but is used for
    // deterministic error reporting (§6).
    for (const file of [...files].sort((a, b) => (a.relpath < b.relpath ? -1 : 1))) {
      writeConfined(staging, file);
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
```

> The drift guard (`06-validation-and-drift-guard.md`) reuses the staging build
> (steps 1–2) **but never performs the swap** — it diffs the staging tree against
> committed `adapters/` and removes the staging dir. The shared piece is
> `newStagingDir` + `writeConfined`; the swap lives only in `publish`.

## 5. Stale cleanup (REQ-EMIT-08)

Stale cleanup is a **property of the whole-subtree swap**, not a separate delete
pass. Because `publish` builds the complete current file set in staging and renames
it onto `adapters/` wholesale, any file present in the old tree but absent from the
freshly computed set simply does not exist in the new tree. Removing or renaming a
tool in the manifest therefore drops its adapter files for **every** target with no
manual step and no per-file diffing (SC-05a).

This is strictly more robust than an in-place "delete files not in the new set"
pass: there is no window in which `adapters/` holds a mix of old and new files, and
a crash mid-build leaves the prior committed tree fully intact (§4, fail-intact).

The drift guard additionally **fails** on committed orphans (files in `adapters/`
absent from a fresh emit) so a human who hand-adds a file, or a bad merge, is
caught in CI — that orphan detection lives in `06-validation-and-drift-guard.md`
(`DriftEntry.kind === "orphan"`), complementing the silent auto-removal here.

## 6. Determinism & idempotency (REQ-EMIT-06, REQ-EMIT-05, REQ-REL-01)

The emitter is byte-stable over **both** inputs — canonical source and override
contents (REQ-EMIT-06, post-fix). The override slots are a *second* input alongside
the canonical source; the guarantee covers the combination. Determinism rules
this document is responsible for:

1. **Stable POSIX sort everywhere a file set is materialized.** `loadOverrides`
   walks in POSIX sort; `applyOverrides` returns `files` / `overridden` /
   `staleOverrides` POSIX-sorted; `publish` writes in POSIX sort. No reliance on
   filesystem `readdir` order or `Map` insertion order for externally observable
   results.
2. **No timestamps, no pid, no host data in any file content.** The only place a
   pid appears is the *staging directory name* (`.tmp-<pid>`), which is never
   published — it is always renamed onto `adapters/`. Published file bytes contain
   no run-specific data.
3. **Verbatim override bytes.** An override is copied exactly as authored: no
   trailing-newline normalization, no YAML reflow, no provenance header injection.
   Two builds with identical override contents produce identical overridden files.
4. **YAML/JSON serialization uses `YAML_OPTS`** (`00` §5) wherever this layer
   re-serializes (it generally does not — overrides are verbatim; the transforms in
   `04` own serialization).

### 6.1 Idempotency (REQ-EMIT-05)

A build against unchanged canonical input **and** unchanged overrides produces
**zero changes** to `adapters/`:

- The freshly staged tree is byte-identical to the committed tree (rules 1–4).
- The whole-subtree swap replaces identical bytes with identical bytes; git sees no
  diff (SC-03).
- Override slots are never written to, never deleted — they live in `overrides/`,
  which `publish` never touches. A rebuild cannot clobber an override (REQ-EMIT-05).

Verification of idempotency is a build-twice / `--check`-clean test owned by
`06-validation-and-drift-guard.md` and `08-testing-strategy.md`.

## 7. Write & read confinement (REQ-SEC-01)

`src/paths.ts` ports feature-forge's `allowed_root` containment guard
(`scripts/build-adapters.py` `_assert_within`, lines ~966–991). Every read and
every write resolves its path and asserts it stays within an allowed root; an
escape (e.g. a `../` in a manifest `source` or an override relpath) throws
`PathEscapeError` (`00` §4) rather than reading or writing the file.

```typescript
import { resolve, sep } from "node:path";
import { PathEscapeError } from "./errors.js";

/**
 * Resolve `candidate` against `root` and assert the result stays inside `root`.
 *
 * Ports feature-forge's `allowed_root` guard (REQ-SEC-01, tech-spec §3.6). Used
 * for EVERY filesystem path the emitter touches: canonical-source reads, override
 * reads, staging writes, and post-swap `adapters/` paths. Symlinks are resolved by
 * `fs.realpath` at the call site before confinement where the target may be a
 * symlink; `confinePath` itself does lexical + `path.resolve` normalization, which
 * collapses `..` segments.
 *
 * @param root      The allowed root (absolute). One of: canonical source dirs,
 *                  `overridesDir`, the staging dir, or `adaptersDir`.
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
```

### 7.1 Resolved roots

```typescript
/** Absolute roots derived from EmitterConfig (00 §2.3) by src/config.ts (01 §2). */
export interface ResolvedRoots {
  repoRoot: string;
  skillsDir: string;
  agentsDir: string;
  commandsDir: string;
  referencesDir: string;
  scriptsDir: string;
  /** Read root for override slots. The ONLY non-canonical read root. */
  overridesDir: string;
  /** Write root for the published tree. */
  adaptersDir: string;
}
```

`config.ts` (`01` §2) builds `ResolvedRoots` by resolving each `EmitterConfig` path
against `repoRoot`. Every read in `loadOverrides` is confined to `overridesDir`;
every read in discovery (`03`) is confined to the canonical source dirs; every
write in `publish` is confined first to the staging dir and, after the swap, the
published paths are guaranteed under `adaptersDir`. No path is read outside the
canonical source + declared override slots, and none is written outside the
staging dir + `adapters/` (REQ-SEC-01).

### 7.2 Confinement matrix

| Operation | Allowed root | Module |
|-----------|--------------|--------|
| Read canonical file/dir | `skillsDir`/`agentsDir`/`commandsDir`/`referencesDir`/`scriptsDir` | `03` discover |
| Read override file | `overridesDir` | `loadOverrides` (this doc §3.1) |
| Write staged file | staging dir `<adaptersDir>.tmp-<pid>` | `publish` (§4.2) |
| Final published path | `adaptersDir` | `publish` swap (§4.3) |

Any path resolving outside its column-2 root → `PathEscapeError`, fatal, no write
(`00` §4; tech-spec §7). Because it is thrown *before* the publish swap, a path
escape leaves `adapters/` intact (§4).

## Dependencies

Must be implemented first:

- `00-core-definitions.md` — `EmittedFile`, `EmitResult`, `VerbatimRecord`,
  `ReportModel`, `Target`, `PathEscapeError`, `YAML_OPTS`, `TARGET_ORDER`,
  POSIX-sort constants.
- `01-architecture-layout.md` — module layout (`src/overrides.ts`,
  `src/publish.ts`, `src/paths.ts`, `src/config.ts`), the `config.ts` →
  `ResolvedRoots` resolution, the `.gitignore` of `*.tmp-*` staging dirs.
- `02-manifest-and-config.md` — `EmitterConfig` (`overridesDir`, `adaptersDir`,
  `targets`) that feeds `ResolvedRoots`.
- `04-transforms.md` — produces the `EmittedFile[]` (adapter-root-relative
  `relpath`, provenance headers applied) that `applyOverrides` overlays and
  `publish` writes.

Consumed by:

- `06-validation-and-drift-guard.md` — reuses `newStagingDir` + `writeConfined`
  for the `--check` staging build (without the swap); consumes `overridden` and
  `staleOverrides` for `ReportModel`; owns orphan-`DriftEntry` detection that
  complements §5 auto-cleanup.
- `07-packaging-and-sample-tool.md` — the published `adapters/claude/` tree it
  packages is the output of `publish`.
- `08-testing-strategy.md` — determinism (build-twice), confinement (`../` escape),
  stale-override, and stale-cleanup tests target this document's modules.

## Verification

- [ ] `confinePath(root, "a/b")` returns `root/a/b`; `confinePath(root, "../x")`,
      `confinePath(root, "/abs/elsewhere")`, and a relpath with embedded `../`
      escaping `root` each throw `PathEscapeError` with the attempted path
      (REQ-SEC-01).
- [ ] `loadOverrides` on a missing `overridesDir` returns an empty `OverrideSet`
      (no throw); on a present tree returns files keyed by `<target>/<relpath>`
      with modes preserved (`0o755` for an executable override).
- [ ] `applyOverrides` replaces a matching emitted file byte-for-byte with the
      override content, lists it in `overridden`, and the result carries **no**
      provenance header (REQ-EMIT-04 / V-005).
- [ ] An override with no matching emitted file appears in `staleOverrides`, emits a
      warning, and does **not** throw — the build completes (tech-spec §7).
- [ ] `applyOverrides` returns `files`, `overridden`, and `staleOverrides` in stable
      POSIX sort regardless of input order (REQ-EMIT-06).
- [ ] `publish` creates `<adaptersDir>.tmp-<pid>/`, writes all files, then renames
      onto `adaptersDir`; the staging dir does not survive a successful run.
- [ ] Removing a tool from the manifest and rebuilding leaves `adapters/` with
      exactly the current emitted set — the removed tool's files for every target
      are gone, with no manual step (REQ-EMIT-08, SC-05a).
- [ ] A `publish` that throws mid-write (e.g. injected `PathEscapeError`) removes
      the staging dir and leaves the prior `adapters/` tree byte-identical
      (fail-intact, REQ-EMIT-05).
- [ ] Building twice against unchanged canonical input and unchanged overrides
      produces zero diff in `adapters/` (REQ-EMIT-05/06, SC-03).
- [ ] A rebuild never writes to or deletes anything under `overridesDir`
      (overrides preserved, REQ-EMIT-05).
```
