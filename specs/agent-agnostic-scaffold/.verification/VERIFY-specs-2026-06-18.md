# Verification Report: agent-agnostic-scaffold — specs

- **Date:** 2026-06-18
- **Mode:** specs (forge-3-specs complete; forge-verify-specs pending)
- **Method:** 5 parallel `forge-verifier` instances (types/contracts, architecture/layout, cross-reference/traceability, testing strategy, integration/transforms) + deterministic traceability validator.
- **Artifacts reviewed:** PRD.md, tech-spec.md, 00–08 implementation specs, TRACEABILITY.md.

## Deterministic checks

- **Traceability validator:** `valid=true` — 31 requirements, 0 uncovered, 0 orphaned. REQ-PERF-01 (P2, non-target) is intentionally covered only by TRACEABILITY.md.

## Summary

- **Total findings:** 21
- **Errors:** 1 (V-004)
- **Gaps:** 5 (V-007, V-013, V-014, V-017, V-019)
- **Inconsistencies:** 12
- **Improvements:** 3 (V-008, V-016, V-021)

Checks executed across instances: types 6/6, architecture 9/9, cross-reference 7/7, testing 12/12, integration 11/11 — ~45 checks total, none skipped. The bulk of findings are doc-consistency deltas where a downstream spec (00/01/04) evolved past an upstream summary (tech-spec) or a sibling spec; the testing-strategy slice surfaced the most load-bearing issues (test call signatures and emit/publish semantics).

---

## Findings

### V-001: `DropRecord` shape conflicts between tech-spec §4.2 and 00 §3.4
- **Severity:** inconsistency
- **Location:** tech-spec.md §4.2 (line 309) vs 00-core-definitions.md §3.4 (lines 181–192)
- **Issue:** tech-spec §4.2 defines `DropRecord { target, source, construct, reason }` with **no `kind` field**. Authoritative 00 §3.4 defines `DropRecord` with a required `kind: "fallback" | "skipped"` discriminator that the coverage-report subsystem (`TargetCoverage`, `ReportModel.drops`) and 08 fixtures (lines 348/362/402) depend on.
- **Suggested fix:** Update tech-spec §4.2 line 309 to `DropRecord { target, source, construct, kind: "fallback" | "skipped", reason }`. 00 is authoritative.
- **References:** 00 §3.4, 08-testing-strategy.md lines 348/362/402, PRD REQ-EMIT-03/03a
- **Checklist:** CHECK-S12, CHECK-S05

### V-002: `targets` value-schema named `TargetOverrides` in tech-spec vs `TargetToolFlags` in 00; enum literals re-spelled inline
- **Severity:** inconsistency
- **Location:** tech-spec.md §4.1 (lines 261–268) vs 00 §2.2 (lines 53–72)
- **Issue:** tech-spec §4.1 names the per-target value `TargetOverrides` and re-lists the target enum literals inline rather than reusing the `Target` enum. 00 §2.2 names it `TargetToolFlags` with `z.record(Target, TargetToolFlags)`. Shapes are equivalent; names and enum source-of-truth diverge.
- **Suggested fix:** In tech-spec §4.1 rename to `TargetToolFlags` and use `z.record(Target, TargetToolFlags)` reusing the single `Target` enum, or add a note that 00 §2.2 is authoritative and the block is illustrative.
- **References:** 00 §2.2, tech-spec.md §4.1
- **Checklist:** CHECK-S12, CHECK-S05

### V-003: Several exported record fields in 00 §3 lack the per-field doc comments the doc's own quality bar mandates
- **Severity:** inconsistency
- **Location:** 00 §3 (lines 129–166, 200–206)
- **Issue:** 00 §1 (line 30) mandates "Doc comments on every exported type and field," but `SkillRecord`/`AgentRecord`/`CommandRecord` `.name/.description/.body/.sourcePath`, `ManifestEntry.name/.description`, and `EmittedFile.content` are undocumented.
- **Suggested fix:** Add `/** … */` to each undocumented field (one line each).
- **References:** 00 §1, §3.1–§3.4
- **Checklist:** CHECK-S13

### V-004: Test fixture `SkillRecord.metadata` uses flattened top-level key, contradicting the canonical TQ-3 nested shape in 03
- **Severity:** error
- **Location:** 08 §4.4 (lines 325–332) vs 03 §4/§5 (lines 519–564, example line 601)
- **Issue:** Fixture builds `metadata: new Map([["argument-hint", "<topic>"]])` — `argument-hint` at top level. 03 §4 (TQ-3 resolution) and its example (line 601) fix the canonical shape as a single `"metadata"` key whose value is an ordered Map of `argument-hint`/`allowed-tools`. The fixture exercises a shape real discovery would not produce for canonical input, so the cursor-transform test could pass against a broken implementation.
- **Suggested fix:** Confirm against 04 §5.2 which shape the cursor transform reads; then either nest the fixture to `metadata: new Map([["metadata", new Map([["argument-hint", "<topic>"]])]])` or add a comment + a second canonical-shape fixture. If 04 itself reads the flattened shape, raise a deeper 03/04 inconsistency.
- **References:** 03 §4/§5, 04 §5.2, PRD REQ-EMIT-03
- **Checklist:** CHECK-S37, CHECK-S12

### V-005: Barrel (`src/index.ts`) in 01 §5 omits `emitPlugin`, which 07 twice claims is re-exported
- **Severity:** inconsistency
- **Location:** 01 §5 vs 07 §3.2 (~line 107) and §5.2 mode B (~line 316)
- **Issue:** 07 states `emitPlugin`/`PluginMeta` are "re-exported via the barrel," but 01 §5 exports only `./errors.js`, `./model.js`, `loadManifest`, `emit`, `driftCheck`. An implementer following 01 verbatim would break the reuse contract 07 §5.2 mode B promises.
- **Suggested fix:** Add `export { emitPlugin } from "./plugin.js";` and `export type { PluginMeta } from "./plugin.js";` to 01 §5; update §5 prose and the barrel-export verification checkbox.
- **References:** 01 §5 + §verification, 07 §3.2/§3.3/§5.2/§5.5, 00 §4
- **Checklist:** CHECK-S17, CHECK-S26, CHECK-S32

### V-006: tech-spec §2 `src/` tree omits six modules that 01 introduces and other specs own
- **Severity:** inconsistency
- **Location:** tech-spec.md §2 (lines 40–85) vs 01 §2 (lines 26–88)
- **Issue:** 01 §2 (canonical layout, REQ-STRUCT-01) adds `config.ts` (02 §3), `schema-gen.ts` (02 §4), `frontmatter.ts` (03), `paths.ts` (05), `targets/index.ts`, `plugin.ts` (07), and references a `schemas/` dir; tech-spec §2 lists none. Normal forward-evolution, but tech-spec reads as authoritative-and-contradictory.
- **Suggested fix:** Add a one-line note to tech-spec §2 that 01 §2 is authoritative and the tree is indicative (preferred), or add the six modules. Do not change 01.
- **References:** tech-spec.md §2/§3.3, 01 §2, 02 §1, 07 §1
- **Checklist:** CHECK-S06, CHECK-S07

### V-007: `schemas/` output path is hardcoded, undercutting the REQ-REUSE-01 "no hardcoded paths" claim
- **Severity:** gap
- **Location:** 02 §4 (`SCHEMA_OUTPUT_PATH = "schemas/tools.manifest.schema.json"`, ~line 342) vs 01 §verification (~line 217) and 07 §5.1/§5.5
- **Issue:** `EmitterConfig` (00 §2.3) has no `schemasDir`, so the committed-schema path is a hardcoded literal. 01/07 claim *no* emitter module hardcodes a path and *every* path is config-driven (REQ-REUSE-01). The `grep -ri "agent-docs" src/` reuse check passes (literal is `schemas/`), so the violation is silent.
- **Suggested fix:** Either (a) add `schemasDir: z.string().default("schemas")` to `EmitterConfig` (00 §2.3, tech-spec §4) and derive the path from it, or (b) scope the "no hardcoded paths" claim (01 §verification, 07 §5.1) to adapter/canonical roots and document `schemas/` as a fixed build path like `dist/`. Prefer (b) unless schema relocation is a real reuse need. **User decision required.**
- **References:** 00 §2.3, tech-spec.md §4, 02 §4, 01 §verification, 07 §5.1/§5.5
- **Checklist:** CHECK-S17, CHECK-S26

### V-008: `.gitignore`/`dist/` posture stated incompletely in 01 §2
- **Severity:** improvement
- **Location:** 01 §2 (lines 35, 90–91) vs 01 §4 (lines 182, 186)
- **Issue:** 01 §2 says `.gitignore` "excludes only `node_modules/` and `*.tmp-*`," but `dist/` is build output (01 §4, ESLint ignores it) and is not mentioned. If `dist/` is generated-not-committed it should be gitignored.
- **Suggested fix:** Clarify whether `dist/` is committed or gitignored; if not committed, add `dist/` to the exclusion list and update the "excludes only…" wording, keeping the "NOT adapters/ (CON-02)" guarantee. **User decision required.**
- **References:** 01 §2, §4
- **Checklist:** CHECK-S06

### V-009: TOML-serializer dependency is resolved in 01 but 04, 08, and tech-spec still carry it as an unresolved open WARNING with a dangling "resolve in 05/08" pointer
- **Severity:** inconsistency
- **Location:** 04 §7.5 (lines 582–587) and §12 (lines 985–987); 08 §10 (lines 903–917); tech-spec.md §9 (lines 423–433). *(Merged from cross-reference V-001/V-002 and integration V-T01.)*
- **Issue:** 01 §3 already commits `smol-toml@^1.3.0` for byte-stable Codex/Gemini TOML (pipeline notes confirm). But 04 §7.5/§12 and 08 §10 still state "there is no TOML library" and instruct the implementer to choose/add one, and 04 directs resolution "to 05/08" — yet 05's Dependencies list has no TOML library and 08 §10 re-raises rather than resolves it. The pointer chain loops without terminating; tech-spec §9 lists only `yaml`. A fresh implementer would believe the decision is open and might pick a different library or hand-roll.
- **Suggested fix:** In 04 §7.5/§12 and 08 §10, replace the open WARNING/ACTION with: "RESOLVED — byte-stable TOML via `smol-toml@^1.3.0` (see 01 §3 `package.json`). Residual carry-forward: verify/pre-sort `smol-toml` key ordering for REQ-EMIT-06 and triple-quote multiline strings." Redirect the "05/08" pointer to "01 §3." Update tech-spec §9 dep list (or note) to include `smol-toml`. Optionally add `smol-toml` to 04 §1 Dependencies.
- **References:** 01 §3, 05 Dependencies (lines 465–479), 08 §10, tech-spec.md §9, TRACEABILITY.md carry-forward WARNINGs
- **Checklist:** CHECK-S30, CHECK-S33 (cross-doc consistency / carry-forward resolution)

### V-010: `emit`/`driftCheck` test call signatures use a bare string where 05/06 require `ResolvedRoots`
- **Severity:** inconsistency
- **Location:** 08 §5.1/§5.2/§5.3/§6.2/§6.4/§7.1 (every `emit`/`driftCheck`/`emitPlugin` call)
- **Issue:** Tests call `emit(repo.manifest, repo.root)` where `repo.root` is a plain string, but 06 §2.3/§2.4 fix the signature as `(manifest, roots: ResolvedRoots)` (a structured object per 05 §7.1). Every load-bearing determinism/drift/golden/override/schema test would fail to type-check against the real signature — the single most-repeated call in the file.
- **Suggested fix:** Add a `makeFixtureRoots(repo): ResolvedRoots` helper (or have `makeFixtureRepo` return a `roots: ResolvedRoots` field built via `config.ts`'s resolver from 05 §7.1); change all call sites to `emit(repo.manifest, repo.roots)`. Update the §3 factory block.
- **References:** 06 §2.3/§2.4, 05 §7.1, 00 §2.3
- **Checklist:** CHECK-S37, CHECK-S33

### V-011: Determinism/orphan/override tests assume `emit` writes to disk, but 05/06 define `emit` as returning an in-memory `EmitResult` (publish is separate)
- **Severity:** inconsistency
- **Location:** 08 §5.1 (test 2), §5.2 (drift/orphan via `anyAdapterFile(repo.root,…)`), §5.3 (override-survival reads `adapters/cursor/.../sample.mdc`)
- **Issue:** 05 §1 orchestration is `discover → transform → loadOverrides → applyOverrides → publish`, and 06 §2.4 calls `emit(...)` then *separately* `applyOverrides(result.files, overrides)` — so `emit` is in-memory, pre-overlay, and does not write disk. Yet several tests call only `emit(...)` then read committed files from `adapters/<target>/...` and expect `result.overridden`. The §5.1 hedge acknowledges this for one of ~six affected tests only.
- **Suggested fix:** Pick one pattern and apply uniformly: (a) a `buildAndPublish(manifest, roots)` helper running `emit → applyOverrides → publish`, with disk-reading tests using it; or (b) keep in-memory by asserting against `applyOverrides(emit(...).files, loadOverrides(...))`. Fix §5.3's `result.overridden` to read from the `OverlayResult` (05 §3.2). **User decision required** (confirm emit semantics).
- **References:** 05 §1/§3.2/§4, 06 §2.4
- **Checklist:** CHECK-S37, CHECK-S33

### V-012: Orphan/golden tests hardcode `adapters/cursor/skills/...` paths not cross-checked against 04's transform table
- **Severity:** inconsistency
- **Location:** 08 §5.2 orphan test (`fs.existsSync(.../adapters/cursor/skills/doomed)`) and §6.2 golden filter (`.includes(SAMPLE)`)
- **Issue:** `EmittedFile.relpath` and `DriftEntry` keys are both `<target>/<relpath>` (05 §2, 06 §2.2), but the actual per-target cursor layout is governed by 04 §5.2. If cursor output is flattened (`rules/<n>.mdc`) rather than `skills/<n>/...`, the hardcoded orphan `existsSync` path and the golden `.includes(SAMPLE)` filter are wrong.
- **Suggested fix:** Derive orphan/golden relpaths from the emitted set / 04 §5.2 exact relpaths rather than hardcoded directory shapes; assert `driftCheck` returns an `orphan` entry whose `relpath` matches the doomed tool and that no surviving `committed` relpath contains `doomed` after rebuild.
- **References:** 04 §5.2, 05 §2, 06 §2.2
- **Checklist:** CHECK-S37 (golden-snapshot strategy)

### V-013: Golden suite's emitted-vs-golden accounting uses `arrayContaining` (superset-only), missing new unreviewed outputs
- **Severity:** gap
- **Location:** 08 §6.2 ("every golden file is accounted for")
- **Issue:** `expect([...emitted.keys()].sort()).toEqual(expect.arrayContaining([...golden.keys()]))` only checks emitted ⊇ golden; it does not fail when emit produces a sample-skill file with no golden counterpart — exactly the regression goldens exist to catch (REQ-VALID-04).
- **Suggested fix:** Use bidirectional set equality on sample-skill-scoped relpaths: `expect([...emitted.keys()].sort()).toEqual([...golden.keys()].sort())`.
- **References:** REQ-VALID-04, 06 §5
- **Checklist:** CHECK-S37 (golden strategy)

### V-014: No test or gate enforces byte-stable TOML; the REQ-EMIT-06 determinism property is conditionally unverified
- **Severity:** gap
- **Location:** 08 §10 and §5/§6 (no TOML determinism case)
- **Issue:** §5.1's determinism test snapshots one fixture not asserted to include a TOML-emitting tool, so it could pass while TOML output is unstable. The byte-stable-TOML concern is left to implementer diligence rather than a concrete test.
- **Suggested fix:** Add a determinism case in §5.1 that includes a TOML-emitting construct (codex/gemini command), asserting two emits produce byte-identical TOML, and require the §3 fixture factory to include a command tool. If 04 finalizes that no target emits TOML, downgrade §10 to a resolved note.
- **References:** 04 §3.5/TQ-1/TQ-2, REQ-EMIT-06; ties to V-009
- **Checklist:** CHECK-S37, CHECK-S33

### V-015: §4.1 hardcodes `config.targets` default array unverified against 00 §5 / 02
- **Severity:** inconsistency
- **Location:** 08 §4.1 ("applies config defaults")
- **Issue:** Test asserts `config.targets` default `["claude","codex","copilot","cursor","gemini"]` inline. Must match the `TARGET_ORDER`/config default in 00 §5 and 02 — including whether `claude` is part of the configurable array or implicit (06 §4 treats claude/copilot/cursor as schema no-ops; CON-04 phrases the four as Codex/Cursor/Gemini/Copilot "plus canonical Claude").
- **Suggested fix:** Bind the expected default to 00 §5 `TARGET_ORDER` / 02's schema with a cross-reference; correct the array if `claude` is implicit.
- **References:** 00 §5, 02 config defaults, PRD CON-04
- **Checklist:** CHECK-S37 (schema-validation tests)

### V-016: Co-located test suites use inconsistent fixture import paths and §6.4 omits `afterEach` cleanup
- **Severity:** improvement
- **Location:** 08 §6.4 (`import … from "./test/__fixtures__"; // adjust to actual path`) vs §4.3 (`./__fixtures__`)
- **Issue:** Co-located `src/*.test.ts` suites use different relative prefixes for the same fixtures dir, and §6.4 leaves a `// adjust` TODO and calls `cleanupFixtureRepo(repo)` inline (leaks temp dir on assertion failure) instead of the `afterEach` pattern used elsewhere.
- **Suggested fix:** Standardize the fixtures import path across co-located suites, resolve the §6.4 TODO, and convert §6.4 to the `afterEach(() => repos.forEach(cleanupFixtureRepo))` pattern.
- **References:** 08 §3, §4.3
- **Checklist:** CHECK-S37 (testing conventions)

### V-017: 04 §7.4 calls `stringifyYaml` with no import shown and a call signature unconfirmed against the `yaml` API
- **Severity:** gap
- **Location:** 04 §7.4 (line 560)
- **Issue:** The codex `aggregateManifest` calls `stringifyYaml(doc, YAML_OPTS)` but no import is shown; 00 exports `YAML_OPTS` (options object) not a function. The `yaml` package exports `stringify` (signature `stringify(doc, replacer, options)`), so the two-arg call needs confirmation. Form C `_generated`-first ordering depends on `sortKeys: false` being honored.
- **Suggested fix:** State `import { stringify as stringifyYaml } from "yaml";` in 04 and confirm `stringifyYaml(doc, YAML_OPTS)` uses the single-options-arg overload with `sortKeys: false`. Mirror 03 §2.3's `serializeFrontmatter` sourcing note.
- **References:** 00 §5 (YAML_OPTS), 03 §2.3
- **Checklist:** CHECK-S33 (external format correctness)

### V-018: tech-spec §5.2 per-target file forms are stale (codex skill `<n>.md`, markdown agents) and not flagged as superseded by 04
- **Severity:** inconsistency
- **Location:** 04 §7.1/§7.2 (codex skill → `skills/<n>/SKILL.md`) vs tech-spec.md §5.2 (line 333: `skills/<n>/<n>.md`)
- **Issue:** 04 §7/§12 declare 2026 research authoritative and supersede tech-spec where they differ (codex/cursor agents are TOML/`.md`, codex skills are `SKILL.md`), but tech-spec §5.2 is never marked superseded — a reader cross-checking 07 §7.2 against tech-spec sees two filenames with no breadcrumb.
- **Suggested fix:** Add a note to tech-spec §5.2 that 04 §7–§10 (2026 research) is authoritative for per-target filenames/formats, calling out the codex `SKILL.md` and agent TOML revisions.
- **References:** 07 §7.2–§7.5, 04 §12
- **Checklist:** CHECK-S30 (cross-doc consistency)

### V-019: Skill-owned reference / verbatim copying is asserted by 07 §7.3 ("per 04 §8") but no per-target transform section defines it
- **Severity:** gap
- **Location:** 07 §7.3 (line 514) vs 04 §8 (cursor) and §6/§7/§9/§10
- **Issue:** 07 cites "per 04 §8" for carrying `SkillRecord.ownRefs` alongside the cursor rule, but no per-target section describes how `ownRefs` become `VerbatimRecord`s, and `TransformOutput` (04 §3) has no verbatim/ownRefs channel. For the flattened cursor `rules/<n>.mdc` layout, where the `references/` subtree lands is undefined.
- **Suggested fix:** Either add a 04 subsection (e.g. §4.6 "Skill-owned references / verbatim copies") specifying `ownRefs → VerbatimRecord` at a defined per-target relpath (resolving the flattened cursor case), or state verbatim copying is owned by 05/03 and fix the 07 §7.3 citation to point at the real owner.
- **References:** 00 §3.4 (VerbatimRecord, EmitResult.verbatim), 05, 03 (ownRefs discovery)
- **Checklist:** CHECK-S31 (transform completeness / orphaned cross-reference)

### V-020: Gemini extension `name`/`version` are hardcoded literals in 04 §9.2, contradicting 04 §12 and 07 §3.2 (and breaking REQ-REUSE-01)
- **Severity:** inconsistency
- **Location:** 04 §9.2 (lines 789–790) and §9.3 (lines 814–815)
- **Issue:** 04 §12 says extension `name`/`version` "must be sourced from 07, not hardcoded here," yet §9.2 hardcodes `name: "agent-docs"`, `version: "0.1.0"`. 07 §3.2 flows these from `package.json` via `PluginMeta`. A vendoring repo would emit a Gemini manifest naming `agent-docs` (REQ-REUSE-01 violation). The gemini `aggregateManifest(entries)` signature has no channel to receive name/version — a real interface gap.
- **Suggested fix:** Thread identity from resolved config/`PluginMeta`: widen the gemini `aggregateManifest` (or pass a target-level config object) so `name`/`version` arrive as parameters, or post-process the gemini manifest's identity in 05. Update §9.2/§9.3 to show the value from a parameter; reconcile with 07 §3.2 as the single source of project identity. **User decision required** (threading mechanism).
- **References:** 07 §3.2 (PluginMeta, §5 REQ-REUSE-01), 04 §3 (TargetTransform interface)
- **Checklist:** CHECK-S32 (REQ-REUSE-01 coverage)

### V-021: Gemini command `:` subdir namespacing is declared "handled by the engine" but no spec owns it; CommandRecord loses the input
- **Severity:** improvement
- **Location:** 04 §9 (line 726) and §9.2 (lines 799–802)
- **Issue:** 04 keeps the per-command transform flat and punts subdir→`:` namespacing to "the relpath the engine assigns," but no doc specifies that engine behavior — 05 never mentions it, and `CommandRecord` (00 §3.3) carries only a flat `name`, so the source subdir is lost before transform. A documented Gemini correctness rule is asserted-as-handled but unowned.
- **Suggested fix:** Either explicitly scope Gemini `:` namespacing OUT for v1 (state in 04 §9 and note in PRD OOS / a TQ; acceptable since the MVP `docs-helper` sample has no nested commands), or assign an owner in 05/03 specifying how a nested command source maps to an `a:b` relpath and confirm CommandRecord carries enough info. **User decision required** (scope vs. owner).
- **References:** 05 §1, 00 §3.3, tech-spec.md TQ-1
- **Checklist:** CHECK-S31 (best-effort fallback completeness)

---

## Fix Execution Plan

### User decisions required before applying — RESOLVED 2026-06-18
- **V-007:** [RESOLVED] Fixed build path. Scope the "no hardcoded paths" claim (01 §verification, 07 §5.1) to adapter/canonical roots; document `schemas/` as an intentional fixed build path like `dist/`. Do NOT add `schemasDir` to EmitterConfig.
- **V-008:** [RESOLVED] `dist/` is gitignored (generated build output, not committed). Add `dist/` to the 01 §2 `.gitignore` exclusion list.
- **V-011:** [RESOLVED] `emit` is in-memory-only; publish is separate. Add a `buildAndPublish(manifest, roots)` test helper (emit → applyOverrides → publish) and route disk-reading tests through it.
- **V-020:** [RESOLVED] Thread Gemini extension `name`/`version` from config/`PluginMeta` (widen `aggregateManifest` to receive them as a parameter).
- **V-021:** [RESOLVED] Gemini `:` subdir namespacing is OUT of scope for v1 (MVP `docs-helper` sample has no nested commands). State flat-only in 04 §9 and note in PRD OOS / TQ-1.

### Step 1 — Sync upstream contracts (tech-spec ↔ 00/01/04)
- **Files:** tech-spec.md §4.1/§4.2/§5.2/§9, 01 §2 note
- **Addresses:** V-001, V-002, V-006, V-018, and the tech-spec §9 part of V-009
- **Action:** Add `kind` to `DropRecord`; rename `TargetOverrides`→`TargetToolFlags` reusing the `Target` enum; add the indicative-tree note pointing to 01 §2; mark §5.2 per-target forms superseded by 04 §7–§10; add `smol-toml` to the §9 dep list.
- **Depends on:** none

### Step 2 — Documentation completeness in 00/01
- **Files:** 00 §3 (field doc comments), 01 §5 (barrel)
- **Addresses:** V-003, V-005
- **Action:** Add `/** … */` to undocumented exported fields; add `emitPlugin`/`PluginMeta` to the 01 §5 barrel + verification checkbox and prose.
- **Depends on:** none

### Step 3 — Resolve the TOML-serializer carry-forward
- **Files:** 04 §7.5/§12, 08 §10 (tech-spec §9 done in Step 1)
- **Addresses:** V-009
- **Action:** Replace "no TOML library / choose one / resolve in 05/08" with "RESOLVED — `smol-toml@^1.3.0` (01 §3); residual caveat = verify/pre-sort key ordering + triple-quote multiline for REQ-EMIT-06." Optionally add `smol-toml` to 04 §1 Dependencies.
- **Depends on:** none

### Step 4 — Testing-strategy corrections (08)
- **Files:** 08 §3, §4.1, §4.3, §5.1, §5.2, §5.3, §6.2, §6.4
- **Addresses:** V-010, V-011, V-012, V-013, V-014, V-015, V-016
- **Action:** Add `roots: ResolvedRoots` to the fixture factory and switch all `emit/driftCheck` calls to it (V-010); introduce one emit/publish test pattern per the V-011 decision and route disk-reading tests through it; derive orphan/golden relpaths from 04 §5.2 instead of hardcoded paths (V-012); make §6.2 a bidirectional set-equality (V-013); add a TOML byte-identity determinism case + command tool in the determinism fixture, or resolve §10 to a note (V-014, ties to V-009); bind §4.1's `config.targets` expectation to 00 §5/02 (V-015); standardize fixture import paths and convert §6.4 to `afterEach` cleanup (V-016).
- **Depends on:** V-011 decision; coordinate V-004's cursor-shape confirmation with V-012

### Step 5 — Transform/reuse correctness (04/05/07)
- **Files:** 04 §7.4, §9.2/§9.3, new §4.6; 07 §7.3; possibly 05, 00 §3.3
- **Addresses:** V-017, V-019, V-020, V-021, V-004
- **Action:** Name the `stringifyYaml` import and confirm its signature (V-017); define `ownRefs → VerbatimRecord` per-target emission and fix the 07 §7.3 citation (V-019); thread Gemini `name`/`version` from config/`PluginMeta` per the V-020 decision; scope or assign an owner for Gemini `:` namespacing per V-021; confirm the cursor metadata shape and fix the 08 §4.4 fixture accordingly (V-004).
- **Depends on:** V-020 and V-021 decisions; V-004 needs the 04 §5.2 cursor-shape confirmation shared with V-012

---

*Generated by 5 parallel forge-verifier instances + deterministic traceability validator. Findings dedup'd (V-009 merges the TOML drift flagged independently by the cross-reference and integration instances); V-NNN IDs renumbered uniquely across the merged set.*

## Fix Progress

- Step 1: [APPLIED] 2026-06-18 — tech-spec.md §4.2 DropRecord+kind (V-001), §4.1 TargetToolFlags rename reusing Target enum (V-002), §2 indicative-tree note (V-006), §5.2 superseded-by-04 note (V-018), §9 added smol-toml (V-009); PRD.md OOS-05 Gemini namespacing out-of-scope (V-021).
- Step 2: [APPLIED] 2026-06-18 — 00 §3 doc comments on 14 fields (V-003); 01 §5 barrel now exports emitPlugin/PluginMeta + prose + verification checkbox (V-005); 01 §verification scoped no-hardcoded-paths claim to roots, schemas//dist/ noted as fixed build paths (V-007); 01 §2 .gitignore adds dist/ (V-008).
- Step 3: [APPLIED] 2026-06-18 — 04 §7.5/§12/§1 TOML resolved to smol-toml (V-009); 08 §10 downgraded to resolved note (V-009).
- Step 4: [APPLIED] 2026-06-18 — 08 fixture roots:ResolvedRoots threaded (V-010), buildAndPublish helper + in-memory emit semantics (V-011), orphan/golden relpaths derived not hardcoded (V-012), bidirectional golden equality (V-013), TOML determinism case + §10 note (V-014), §4.1 targets bound to TARGET_ORDER (V-015), §4.4 fixture nested canonical metadata shape (V-004), §6.4 import path + afterEach cleanup (V-016). Also corrected latent cursor override relpath cursor/rules/sample.mdc.
- Step 5: [APPLIED] 2026-06-18 — 04 §7.4 stringifyYaml import note (V-017), new §4.6 ownRefs→VerbatimRecord with cursor relpath rules/<n>/<ref-subpath> (V-019), §9.2/§9.3/§3 gemini aggregateManifest widened with identity param from PluginMeta (V-020), §9 namespacing out-of-scope (V-021); 07 §7.3 citation → 04 §4.6, §3.2 PluginMeta identity confirmed (V-019/V-020); 05 §4 publish includes EmitResult.verbatim channel (V-019).

All 21 findings addressed. User decisions V-007/V-008/V-011/V-020/V-021 resolved (see above).
