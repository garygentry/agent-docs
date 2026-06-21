# Verification Report — doc-site-plugin (specs mode)

- **Feature:** doc-site-plugin
- **Mode:** specs
- **Date:** 2026-06-19
- **Pipeline stage:** forge-3-specs complete; forge-verify-specs in progress
- **Artifacts verified:** PRD.md, tech-spec.md, 00–10 (all 11 spec docs), TRACEABILITY.md, cross-checked against live `src/` source
- **Dispatch:** 5 parallel `forge-verifier` instances (types/contracts, architecture/layout, cross-reference/traceability, testing, integration)
- **Checks executed:** ~35 across the 5 dimensions (S-cluster)
- **Findings count:** 8 (errors: 0, gaps: 1, inconsistencies: 5, improvements: 2)

## Summary

The suite is structurally sound: traceability is complete (34/34 requirements, 0
uncovered), the `assets/`→`references/` relocation is confirmed correct against
`src/discover.ts:105-117` and consistently applied, and every cited integration
signature (`ToolEntry`, `skillRefDir`, `skillVerbatimRecords`, `Manifest`,
`schema-gen`, the gate chain, the uniform sibling renderer path) was validated
against real source and matches.

The findings concentrate in one real cluster — the **token-coverage contract is
internally contradictory** (`00 §4.1`, `04 §2.2`, and the `10 §4.1` in-test mirror
disagree on which tokens exist), which would make the spec's own token-coverage test
fail as written — plus several testing/wording accuracy fixes (the gemini aggregate
golden, three-way set-equality wording, a coverage claim presented as already-met,
and an inherited "executable mode" inaccuracy). None require user decisions.

---

## Findings

### V-001: `{{IMAGES_SRC_DIR}}` used in template (04) but absent from the canonical token table (00 §4.1)
- **Severity:** inconsistency
- **Location:** `04-content-symlink-layer.md` §2 (`setup-docs.sh.tmpl` body, `link_dir "{{IMAGES_SRC_DIR}}" "images"`) and §2.2; vs `00-core-definitions.md` §4.1
- **What's wrong:** `00 §4` states the closed-vocabulary rule: every token in `references/templates/**` MUST have a row in the §4.1 canonical table (enforced by the token-coverage test). `setup-docs.sh.tmpl` uses `{{IMAGES_SRC_DIR}}`, but §4.1 has no row for it. As written, the token-coverage test would flag it as an undefined token.
- **Suggested fix:** Add a row to `00 §4.1`: `| {{IMAGES_SRC_DIR}} | interview/detection (images dir) | docs/images (or {{DOCS_PKG_DIR}}/images) | symlink (setup-docs.sh) |`. In `04 §2.2`, change the local row to cite "defined in 00 §4.1".
- **References:** 00 §4 closing rule, 00 §4.1; 04 §2/§2.2; 10 §4.2
- **Checklist:** CHECK-S10, CHECK-S12

### V-002: `10 §4.1` `CANONICAL_TOKENS` mirror omits three tokens the templates use
- **Severity:** inconsistency
- **Location:** `10-testing-strategy.md` §4.1 (`CANONICAL_TOKENS`, 14 entries) vs `00-core-definitions.md` §4.1 (16 rows) and actual template token use
- **What's wrong:** `CANONICAL_TOKENS` is declared the in-test mirror of `00 §4.1` but omits `DOCS_PKG_DIR_TO_ROOT` and `SYMLINK_PAGE_LINES` (both ARE rows in `00 §4.1`) and `IMAGES_SRC_DIR` (see V-001). The §4.2 test asserts both `used ⊆ canonical` and `canonical ⊆ used`; since `setup-docs.sh.tmpl` uses all three, the "no undefined tokens" assertion would fail. The spec's verification surface contradicts the contract it mirrors.
- **Suggested fix:** Add `"DOCS_PKG_DIR_TO_ROOT"`, `"SYMLINK_PAGE_LINES"`, `"IMAGES_SRC_DIR"` to `CANONICAL_TOKENS` so it exactly mirrors the corrected `00 §4.1`.
- **References:** 10 §4.1, §4.2; 00 §4.1; 04 §2/§2.2
- **Checklist:** CHECK-S10, CHECK-S12

### V-003: `04 §2.2` states `{{SYMLINK_PAGE_LINES}}` is "not in 00 §4.1" — but it is
- **Severity:** gap
- **Location:** `04-content-symlink-layer.md` §2.2 (`{{SYMLINK_PAGE_LINES}}` row) vs `00-core-definitions.md` §4.1 + §4 "Direct vs. derived tokens" note
- **What's wrong:** `04 §2.2` claims `{{SYMLINK_PAGE_LINES}}` is "Not in 00 §4.1's table because it is a generated block," but `00 §4.1` does carry that row (classified as a derived/generated token). A fresh implementer trusting `04` would omit it from the test mirror, compounding V-002.
- **Suggested fix:** Correct the `04 §2.2` row to state `{{SYMLINK_PAGE_LINES}}` IS defined in `00 §4.1` (derived/generated) and detailed here — matching how `04 §2.2` already cross-references `{{DOCS_PKG_DIR_TO_ROOT}}`. Remove the "Not in 00 §4.1's table" clause.
- **References:** 04 §2.2; 00 §4.1, §4
- **Checklist:** CHECK-S10, CHECK-S12

### V-004: `collectOwnedTree` line citation off by one (104 vs 105)
- **Severity:** improvement
- **Location:** `01-architecture-layout.md` §2.3 (`src/discover.ts:104`); `09-integration-and-emission.md` §3 (same `:104` citation)
- **What's wrong:** `collectOwnedTree` is declared at `src/discover.ts:105`; line 104 is the closing `*/` of its doc-comment, and the `["references","scripts"]` walk loop is at line 107. Every other source anchor in the suite is exact.
- **Suggested fix:** Change `src/discover.ts:104` → `src/discover.ts:107` (the load-bearing `["references","scripts"]` loop line) in both `01 §2.3` and `09 §3`.
- **References:** src/discover.ts:105-117
- **Checklist:** CHECK-S (source-anchor accuracy)

### V-005: `10 §3.2` claims the gemini `gemini-extension.json` aggregate is "unchanged" — it changes
- **Severity:** inconsistency
- **Location:** `10-testing-strategy.md` §3.2 (gemini `SAMPLE_RELPATHS` row: "(+ existing `gemini-extension.json` aggregate is unchanged)")
- **What's wrong:** `aggregateManifest()` (`src/targets/gemini.ts:123-134`) builds `gemini-extension.json` with `skills: entries.map(e => ({name, description}))` — it enumerates every skill. Registering the `doc-site-plugin` ToolEntry adds a row, so the committed golden `src/test/__golden__/gemini/gemini-extension.json` MUST be regenerated. `gemini-extension.json` is already a pinned gemini row in `SAMPLE_RELPATHS` (`golden.shared.ts:61`), so `golden.test.ts`'s byte-exact + set-equality assertions would fail if left stale.
- **Suggested fix:** Replace the parenthetical with: "the gemini `gemini-extension.json` aggregate gains a `doc-site-plugin` `skills[]` row and its golden must be regenerated (`bun run src/test/regenerate-goldens.ts`) alongside the new SKILL row." Add a Verification bullet to regenerate the gemini aggregate golden.
- **References:** src/targets/gemini.ts:123-134; src/test/golden.shared.ts:59-63; src/test/golden.test.ts:70-78; 09 §2/§3
- **Checklist:** CHECK-S (testing — goldens match real infra)

### V-006: `10 §3.2` understates `golden.test.ts` as "bidirectional" — it is three-way set equality
- **Severity:** improvement
- **Location:** `10-testing-strategy.md` §3.2 ("bidirectional set equality"); Verification bullet citing `golden.test.ts:76`
- **What's wrong:** `golden.test.ts:74-78` asserts THREE equalities: emitted⊇golden byte-exact (`:71`), emitted-keys == golden-keys (`:76`), AND golden-keys == pinned `SAMPLE_RELPATHS` set (`:78`). The doc describes only the first two. The third means every added SKILL relpath needs a committed golden and no extra golden may exist unregistered.
- **Suggested fix:** Change "bidirectional set equality" to "three-way set equality (emitted ≡ golden ≡ pinned `SAMPLE_RELPATHS`, `golden.test.ts:76` and `:78`)" and note the five new SKILL rows + five committed goldens must be added together with no extras. (Mirror diagram-generator 08 §8.)
- **References:** src/test/golden.test.ts:74-78; specs/diagram-generator/08-testing-strategy.md §8
- **Checklist:** CHECK-S (testing — fidelity to real test infra)

### V-007: `10` coverage claim presents `static-netlify` template-group coverage as already satisfied
- **Severity:** inconsistency
- **Location:** `10-testing-strategy.md` Requirement-Coverage row "REQ-PORT-02 (scaffolded output) → §5" and §6 Coverage-targets "Substitution procedure" row, vs §5.1 (three answer sets) + §6 item 1 (static-netlify author action)
- **What's wrong:** The three committed answer sets (`single-symlink`, `monorepo-mixed`, `decline-all`) never select the `deploy/static` group, and §6's meta-test will be RED until a fourth answer set is added. The body is honest about this, but the coverage table presents "every emitted template covered by ≥1 fixture" as already-holding — a fix agent could read it as done.
- **Suggested fix:** Annotate both rows with "(holds once the `static-netlify`/`deploy/static` answer set is added — §6 item 1)". No change to the (correctly wired) §6 meta-test.
- **References:** 10 §5.1, §5.2 `GROUPS`, §6 item 1; 01 §2.2
- **Checklist:** CHECK-S (testing — coverage targets)

### V-008: "Executable mode preserved" claim for the vendored renderer is inaccurate (source is 0644)
- **Severity:** inconsistency
- **Location:** `05-diagrams-component.md` §3.1 (lines ~97-100, "verbatim with executable mode preserved"); §3.1 Verification checkbox (line ~398, "and executable")
- **What's wrong:** `src/publish.ts:118` copies verbatim refs with `mode = statSync(sourceAbs).mode & 0o777` — it preserves the source mode, it does not force an exec bit. The source `skills/diagram-generator/scripts/diagram-render.mjs` is `0644` (verified), so emitted copies are `0644`, not executable. The "executable mode preserved" wording is wrong. It does NOT break this feature — every invocation is interpreter-prefixed (`node`/`bun` …, §4/§5.2/§5.3), so the file runs regardless of mode. (Inherited from diagram-generator 06 §5.1.)
- **Suggested fix:** Reword §3.1 to "verbatim with file mode preserved (`statSync(...).mode & 0o777`, src/publish.ts:113-119)"; rebase the "runnable with zero install" rationale on interpreter invocation rather than an exec bit; in the Verification checkbox change "and executable" to "with source file mode preserved". Keep the byte-identity claim.
- **References:** src/publish.ts:113-119; skills/diagram-generator/scripts/diagram-render.mjs (0644); specs/diagram-generator/06-integration-and-packaging.md §5.1
- **Checklist:** CHECK-S31, CHECK-S29

---

## Confirmed correct (not findings)

- **Traceability complete:** validator reports 34 requirements, 0 uncovered. The only
  "orphaned references" (`REQ-DISC-01`, `REQ-TOOLS-01`) are the host emitter's own
  requirement vocabulary quoted in a `src/model.ts` excerpt (TRACEABILITY.md §Notes) —
  benign, do not treat the validator's exit-1 as a finding.
- **`assets/`→`references/` relocation** is correct against `src/discover.ts:105-117`
  and consistently applied across all 11 docs; remaining `assets/` mentions are the
  explanatory "why NOT assets/" text or the superseded tech-spec sketch.
- **All integration signatures verified against source:** `ToolEntry` (model.ts:37),
  `ToolType` (model.ts:15), `Manifest` (model.ts:79-88), `skillRefDir`
  (_shared.ts:203), `skillVerbatimRecords` (_shared.ts:226), `schema-gen` hardwired to
  `Manifest`, gate chain (package.json:25) unchanged, uniform sibling renderer path,
  `SAMPLE_RELPATHS` per-target SKILL shapes, diagram-generator prerequisite present.
- **Accepted limitations (coherently documented):** JSON Schema cannot enforce
  slug-uniqueness (delegated to symlinker/drift-guard); `ajv` is a test-only devDep
  (consistent with "no new runtime dep"); in-repo vs target-repo smoke-test split is
  correct (runtime REQ-VERIFY-01/REQ-DIAG-03 owned by 08, not agent-docs CI);
  decline-all invariant test is concretely specified; no new `gate` stage.

---

## Fix Execution Plan

All fixes are mechanical reconciliations against a single canonical source. **No user
decisions required.**

### Step 1 — Reconcile the token-coverage contract (V-001, V-002, V-003)
Make `00 §4.1` the complete canonical table and bring the two mirrors into lockstep.
1. `00-core-definitions.md` §4.1: add an `{{IMAGES_SRC_DIR}}` row (source: interview/detection images dir; default `docs/images` or `{{DOCS_PKG_DIR}}/images`; used by symlink/`setup-docs.sh`). Confirm `{{DOCS_PKG_DIR_TO_ROOT}}` and `{{SYMLINK_PAGE_LINES}}` rows remain.
2. `04-content-symlink-layer.md` §2.2: change the `{{SYMLINK_PAGE_LINES}}` row to state it IS defined in `00 §4.1` (remove "Not in 00 §4.1's table"); make the `{{IMAGES_SRC_DIR}}` row cite `00 §4.1` as canonical.
3. `10-testing-strategy.md` §4.1: add `"DOCS_PKG_DIR_TO_ROOT"`, `"SYMLINK_PAGE_LINES"`, `"IMAGES_SRC_DIR"` to `CANONICAL_TOKENS` so it mirrors the corrected `00 §4.1` exactly.
   *Order: do (1) first; (2) and (3) depend on it.*

### Step 2 — Testing-strategy accuracy fixes (V-005, V-006, V-007)
In `10-testing-strategy.md`:
1. §3.2 gemini row: replace "(+ existing `gemini-extension.json` aggregate is unchanged)" with a note that the gemini aggregate gains a `doc-site-plugin` `skills[]` row whose golden must be regenerated (`bun run src/test/regenerate-goldens.ts`); add a Verification bullet for it. (V-005)
2. §3.2: change "bidirectional set equality" → "three-way set equality (`golden.test.ts:76` and `:78`)"; note five SKILL rows + five goldens added together, no extras. (V-006)
3. Requirement-Coverage REQ-PORT-02 (scaffolded-output) row and §6 Coverage-targets "Substitution procedure" row: append "(holds once the `static-netlify`/`deploy/static` answer set is added — §6 item 1)". (V-007)

### Step 3 — Source-anchor and wording corrections (V-004, V-008)
1. `01-architecture-layout.md` §2.3 and `09-integration-and-emission.md` §3: change `src/discover.ts:104` → `src/discover.ts:107`. (V-004)
2. `05-diagrams-component.md` §3.1 + Verification checkbox: reword "executable mode preserved"/"and executable" → "file mode preserved (`statSync(...).mode & 0o777`, src/publish.ts:113-119)"; rebase "runnable with zero install" on interpreter invocation (`node`/`bun`). Keep byte-identity claim. (V-008)

---

## Fix Progress

- Step 1: [APPLIED] 2026-06-19 — Token-coverage contract reconciled. Added `{{IMAGES_SRC_DIR}}` row to `00 §4.1` (V-001); corrected `04 §2.2` rows to state `{{SYMLINK_PAGE_LINES}}`/`{{IMAGES_SRC_DIR}}`/`{{DOCS_PKG_DIR_TO_ROOT}}` are defined in `00 §4.1` (V-003); added the three derived/extra tokens to `CANONICAL_TOKENS` in `10 §4.1` (V-002).
- Step 2: [APPLIED] 2026-06-19 — Testing-strategy accuracy. `10 §3.2` gemini row now states the `gemini-extension.json` aggregate gains a row + golden must regenerate, with a new Verification bullet (V-005); "bidirectional" → "three-way set equality (`golden.test.ts:76`/`:78`)" in §3.2 and Verification (V-006); REQ-PORT-02 scaffolded-output coverage rows annotated as gated on the `static-netlify` answer set (V-007).
- Step 3: [APPLIED] 2026-06-19 — `src/discover.ts:104` → `:107` in `01 §2.3` and `09 §3` (V-004); `05 §3.1` + Verification checkbox reworded from "executable mode preserved"/"and executable" to source-file-mode-preserved + interpreter-invoked (V-008).

All 8 findings applied. No user decisions were required.
