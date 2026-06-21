# Verification Findings — agent-agnostic-scaffold (tech mode)

- **Feature:** agent-agnostic-scaffold
- **Mode:** tech
- **Date:** 2026-06-18
- **Artifacts verified:** `tech-spec.md` (against `PRD.md`, plus read-only validation against feature-forge's `build-adapters.py` and the rauf repo)
- **Checks executed:** 17 of 17 — 13 pass, 4 fail, 0 not-applicable
- **Findings:** 5 (3 gap, 1 error, 1 improvement, 0 inconsistency)
- **User decisions required before fixing:** V-004 (where the config surface lives), V-005 (stale override fatal vs warning)

This is a strong, traceable tech spec — every §3 decision cites REQ-IDs, alternatives are documented, the four net-new (no-reference-impl) pieces are flagged, and TQ-1..4 + OQ-05 are legitimately deferred to forge-3-specs (not counted as gaps). The verifier confirmed all ported claims about feature-forge (key order, target order, provenance Form A/B/C, atomic staging publish, `diff -r` drift guard) and the genuinely-shared rauf conventions against source. The one factual error is the "rauf is a Bun project" characterization (V-002).

---

## Findings

### V-001 — REQ-SEC-01 (write-confinement) has no corresponding tech decision
- **Severity:** gap
- **Location:** tech-spec.md §3 Technical Decisions and §7 Error Handling (absent); PRD.md REQ-SEC-01
- **What's wrong:** REQ-SEC-01 (P2) mandates the emitter "MUST only read from the canonical source and declared override slots, and only write within the designated adapter output locations." No tech decision addresses this. The spec describes atomic publish (staging dir → `adapters/`) but states no path-confinement guard. The ported reference `build-adapters.py` *does* implement exactly this — an `allowed_root` path-resolution guard refusing any path resolving outside the staging/`adapters/` root (~lines 972–1025, 1190) — so the capability exists in the source being ported but isn't carried into the spec.
- **Suggested fix:** Add a bullet to §3.6 (or §3.8) noting `publish.ts`/`overrides.ts` resolve and confine all writes to the staging dir and `adapters/` tree, porting feature-forge's `allowed_root` containment guard, satisfying REQ-SEC-01. Optionally add a `PathEscapeError` to §7 for refused out-of-root writes.
- **References:** PRD.md REQ-SEC-01; feature-forge build-adapters.py (`allowed_root`); tech-spec.md §3.4, §3.6
- **Checklist:** CHECK-T03, CHECK-T02

### V-002 — "Match rauf's stack" overstates rauf's package manager (rauf is pnpm, not Bun)
- **Severity:** error
- **Location:** tech-spec.md §1 ("Match rauf's stack — Bun 1.3.10 … the conventions already in rauf") and §3.1
- **What's wrong:** The spec grounds the Bun toolchain in rauf ("match rauf," "adopt rauf's settings verbatim"). Verified against rauf's `package.json`: rauf declares `packageManager: "pnpm@9.15.0"`, `engines.node: ">=22.0.0"`, and top-level scripts use `pnpm -r …`. rauf is a **pnpm workspace monorepo**; Bun appears only as `.bun-version`/`bun.lock` and a script runner. So "Bun-as-toolchain is the convention already in rauf" is imprecise. The Bun+TS mandate itself is fine (CON-01 is an explicit org mandate), but it is not rauf-derived. This matters because forge-3-specs may try to mirror a non-existent rauf Bun project layout. (The genuinely-shared conventions ARE accurate: vitest, zod ^3.24 + zod-to-json-schema with `--check`, prettier ^3, typescript ^5.7, eslint 9 + typescript-eslint — all verified present in rauf.)
- **Suggested fix:** In §1 and §3.1, separate the two claims: (a) Bun+TS is the CON-01 org mandate (cite CON-01, not rauf); (b) what's adopted from rauf is the TS/vitest/zod/zod-to-json-schema/eslint/prettier settings and the `generate-json-schemas.ts --check` pattern. Drop the implication that rauf is Bun-managed; note rauf is pnpm-based and only per-tool TS conventions (not the package manager / monorepo topology) are being matched.
- **References:** rauf package.json (`packageManager: pnpm@9.15.0`); tech-spec.md §1, §3.1; PRD.md CON-01
- **Checklist:** CHECK-T05, CHECK-T02

### V-003 — Coverage-report / drift data model under-specified vs REQ-OBS-01/02 & REQ-VALID-05
- **Severity:** gap
- **Location:** tech-spec.md §3.7, §4.2 (EmitResult), §7 (DriftError)
- **What's wrong:** Two data-requirement alignments are thin. (1) REQ-OBS-01/REQ-VALID-05 require the coverage report to surface per run "targets emitted, tools processed, fallbacks applied, items skipped." §4.2's `EmitResult` carries `files`, `drops`, `manifestEntries`, `overridden`, but has no explicit "tools processed" count/list nor a "Copied verbatim" data field — §3.7 names a "Copied verbatim" report section with no backing record. (2) REQ-OBS-02 requires drift output "clearly identify which adapter files differ and how"; §7's DriftError "lists each differing/orphaned file + remediation" but the per-file "how" (content diff vs orphan vs missing) is not modeled.
- **Suggested fix:** In §4.2 extend `EmitResult` (or add a `ReportModel`) to include processed-tool list, per-target counts (emitted/fallback/skipped/overridden/verbatim), and a typed drift entry `{ relpath, kind: "content" | "orphan" | "missing" }` so REQ-OBS-02's "how" is structured. Cross-reference REQ-OBS-01/02 and REQ-VALID-05.
- **References:** PRD.md REQ-OBS-01, REQ-OBS-02, REQ-VALID-05; tech-spec.md §3.7, §4.2, §7
- **Checklist:** CHECK-T12, CHECK-T10

### V-004 — "Config-driven, path-agnostic" reuse (REQ-REUSE-01) asserted but not specified
- **Severity:** gap
- **Location:** tech-spec.md §3.8 and §2 (no config file in layout); PRD.md REQ-REUSE-01, REQ-EMIT-07/CON-04
- **What's wrong:** §3.8 says the emitter is "config-driven and path-agnostic (root paths and target list come from config/manifest)," but no configuration mechanism is defined: the §2 layout lists no config file, the §4.1 manifest schema has no root-path or target-list fields (it only enumerates tools), and §5/§9 name no config loader. So "root paths and target list come from config" has no concrete home — the target list is currently the literal `claude,codex,copilot,cursor,gemini` in §5.2. For REQ-REUSE-01 (P1) this is the load-bearing decision and is unaddressed.
- **Suggested fix:** Add a §3.x (or extend §3.8) specifying the config surface — e.g. a top-level config block in `tools.manifest.json` (or a separate `emitter.config.json`) declaring canonical root dirs, the `overrides/` and `adapters/` paths, and the target list — and state that `cli.ts`/`emit.ts` read paths from it rather than constants. Reflect in the §2 layout and §4.1 Zod schema. Note CON-04 fixes the target SET for v1 but reuse requires the list be config-sourced.
- **References:** PRD.md REQ-REUSE-01, CON-04, REQ-EMIT-07; tech-spec.md §2, §3.8, §4.1, §5.2
- **Checklist:** CHECK-T14, CHECK-T01

### V-005 — Stale-override (`OverrideConflictError`) policy may conflict with REQ-EMIT-05 idempotency
- **Severity:** improvement
- **Location:** tech-spec.md §7 (OverrideConflictError) vs §3.4; PRD.md REQ-EMIT-04/05/08
- **What's wrong:** §7 defines `OverrideConflictError` for "an override targets a path the emitter does not emit (stale override), surfaced rather than silently applied," but doesn't state whether it's fatal (aborts the build) or a warning. If fatal, a user who renames a canonical tool while leaving an old `overrides/<target>/…` file breaks their build until manual cleanup — in tension with REQ-EMIT-05's "MUST NOT require manual cleanup between runs" and REQ-EMIT-08's auto-orphan handling for emitted files. The asymmetry (emitted orphans auto-dropped; override orphans error) is defensible but should be a deliberate, stated decision.
- **Suggested fix:** In §3.4 or §7, state explicitly whether a stale override is fatal or a warning, and justify the asymmetry with REQ-EMIT-08. Recommended: non-fatal warning listed in GENERATION-REPORT.md (consistent with REQ-EMIT-03's "no silent drops, but warn"), with optional strict mode, so a stale override never hard-blocks a build. If kept fatal, note it as an intentional exception to the auto-cleanup posture.
- **References:** PRD.md REQ-EMIT-04, REQ-EMIT-05, REQ-EMIT-08; tech-spec.md §3.4, §3.6, §7
- **Checklist:** CHECK-T16, CHECK-T10

---

## Fix Execution Plan

### User Decisions Required (blocking for Steps 3 & 5)
- **V-004:** Where does the config surface live — a block inside `tools.manifest.json`, or a separate `emitter.config.json`? Recommended: a block in the manifest (single source of truth, fewer files).
- **V-005:** Is a stale override a fatal error or a non-fatal warning? Recommended: non-fatal warning.

### Execution Steps

**Step 1 — Correct the rauf-stack characterization (V-002).** Files: §1, §3.1. Reword so Bun+TS is attributed to the CON-01 org mandate, not rauf. State rauf is a pnpm workspace monorepo; what's adopted from rauf is the per-tool TS convention set (tsconfig, vitest, zod ^3.24 + zod-to-json-schema with `--check`, eslint 9 + typescript-eslint, prettier ^3) and the `generate-json-schemas.ts --check` pattern — not its package manager or monorepo topology. No dependencies. (CHECK-T05, T02)

**Step 2 — Add write-confinement coverage (V-001).** Files: §3.6 or §3.8, and §7. Add that `publish.ts`/`overrides.ts` resolve and confine all writes to the staging dir and `adapters/` tree (porting feature-forge's `allowed_root` guard), satisfying REQ-SEC-01; optionally add a refused-out-of-root error to §7. Pure addition, no dependencies. (CHECK-T03, T02)

**Step 3 — Specify the configuration surface (V-004).** Files: §2 layout, §3.8, §4.1 schema, §5. *After the V-004 decision:* document the config mechanism (root paths, overrides/adapters paths, target list), add to §2 layout and §4.1 Zod schema, note `cli.ts`/`emit.ts` source paths/targets from config. Depends on V-004 decision; touches §4 data model. (CHECK-T14, T01)

**Step 4 — Strengthen report/drift data model (V-003).** Files: §4.2, §3.7, §7. Extend `EmitResult`/add a report model with processed-tool list, per-target counts (emitted/fallback/skipped/overridden/verbatim), and typed drift entries `{ relpath, kind }`; reference REQ-OBS-01/02 and REQ-VALID-05. Sequence after Step 3 (both edit §4 to avoid conflicting edits). (CHECK-T12, T10)

**Step 5 — Clarify stale-override policy (V-005).** Files: §3.4, §7. *After the V-005 decision:* state whether a stale override is fatal or a warning and justify the asymmetry vs REQ-EMIT-05/08. Depends on V-005 decision. (CHECK-T16, T10)

---

## User Decisions — Resolved

- **V-004:** RESOLVED — config surface is a top-level `config` block in `tools.manifest.json` (single source of truth, one Zod schema).
- **V-005:** RESOLVED — stale override is a **non-fatal warning** listed in GENERATION-REPORT.md; build continues.

## Fix Progress

- Step 1: [APPLIED] 2026-06-18 — §1 + §3.1 reworded: Bun+TS attributed to CON-01 mandate; rauf noted as a pnpm monorepo; only per-tool TS conventions adopted from rauf (V-002).
- Step 2: [APPLIED] 2026-06-18 — §3.6 adds write-confinement bullet (publish.ts/overrides.ts confine writes, port allowed_root guard); §7 adds PathEscapeError (V-001, REQ-SEC-01).
- Step 3: [APPLIED] 2026-06-18 — Added `EmitterConfig` Zod block to §4.1 Manifest (paths + targets); §3.8 + §2 layout note config sourced from manifest; cli.ts/emit.ts read paths/targets from config (V-004, REQ-REUSE-01).
- Step 4: [APPLIED] 2026-06-18 — §4.2 adds VerbatimRecord, ReportModel, DriftEntry{relpath,kind}; EmitResult gains verbatim[]; §3.7 report built from ReportModel; §7 DriftError carries DriftEntry[] (V-003, REQ-OBS-01/02, REQ-VALID-05).
- Step 5: [APPLIED] 2026-06-18 — §3.4 + §7 state stale override is non-fatal warning (staleOverrides in report), justified vs REQ-EMIT-05/08; no OverrideConflictError for that case (V-005).
