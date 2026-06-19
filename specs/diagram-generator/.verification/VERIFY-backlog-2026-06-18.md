# Verification Findings — diagram-generator (backlog)

- **Feature:** diagram-generator
- **Mode:** backlog
- **Date:** 2026-06-18
- **Backlog under test:** `specs/diagram-generator/backlog.json` (18 items, all `pending`)
- **Verifier dispatch:** 4 parallel `forge-verifier` instances (item-scoping/AC, dependency/ordering, spec-coverage/traceability, schema/enum)
- **Findings count:** 12

## Deterministic validation results

- **Loop runner (`rauf backlog validate . --backlog specs/diagram-generator --specs-dir specs/diagram-generator --json`):** `valid: true`, 0 findings. Confirmed it targets the 18-item spec file (not the empty `.rauf/backlog.json`) — re-run verified.
- **JSON Schema (`.rauf/backlog.schema.json`, draft-07):** 0 errors. All required fields present; `type`/`status`/`priority` enums valid; ids `001`–`018` unique and zero-padded; `additionalProperties:false` satisfied; all `dependsOn` resolve.
- **Dependency graph:** acyclic, single root (001), valid topological order exists.

Schema/enum dimension found **no artifact defects**. All 12 findings below are scoping, AC-consistency, dependency-attribution, and traceability issues.

---

## Findings

### V-001 — Item 011 `render()` signature contradicts the authoritative spec
- **Severity:** inconsistency (error-level for a fresh agent)
- **Location:** `backlog.json` item `011` — description and `acceptanceCriteria[0]`
- **What's wrong:** Item 011 specifies `render(spec: DiagramSpec, theme: Theme, accent?: HexColor)` (positional args). The spec `03-rendering-engine.md` §5 (L558-561) defines `render(spec: DiagramSpec, opts: RenderOptions): Promise<RenderResult>` (single options object). Downstream consumers — items 016/017 and `08-testing-strategy.md` §3/§4.4/§5 — all call `render(fixture.spec, { theme, accent })`. Following item 011 verbatim builds the wrong signature and breaks items 016/017 tests.
- **Suggested fix:** Change item 011's description and AC to `render(spec: DiagramSpec, opts: RenderOptions)` where `RenderOptions = { theme: Theme; accent?: HexColor }`. Exercise light/dark via `render(spec, { theme })`.
- **References:** `03-rendering-engine.md` §5 (L558-561); `08-testing-strategy.md` §3/§4.4/§5; items 016, 017
- **Checklist:** CHECK-B (AC correctness / spec consistency)

### V-002 — Item 011 places input validation inside `render()`, contradicting the spec's validation-placement decision
- **Severity:** inconsistency
- **Location:** `backlog.json` item `011` — description and `acceptanceCriteria[2]`
- **What's wrong:** `03-rendering-engine.md` §5 (L504-505, L562-563) is explicit: `render` does **not** re-validate; the CLI calls `parseSpec` at the boundary (`05 §3.1`) and `render` trusts the typed `DiagramSpec`. Item 011 instructs calling `parseSpec` inside `render` and asserts (AC #3) that `render` throws `DiagramInputError` on an invalid spec — duplicating validation and changing the module boundary (REQ-REL-01). Item 011's own notes already say "validate input BEFORE rendering," an internal contradiction.
- **Suggested fix:** Rewrite item 011 so validation is owned by the CLI (item 012). Drop AC #3's "render throws DiagramInputError." If input-validation-before-render must be asserted, assign it to item 012's AC. Keep `assertOutputValid` AFTER post-processing in `render` (correct per §5).
- **References:** `03-rendering-engine.md` §5.2 (L504-505, L562-563); `02-schema-and-validation.md` §2; item 012
- **Checklist:** CHECK-B (AC correctness / spec consistency)

### V-003 — Item 003 misstates the `assertOutputValid` signature
- **Severity:** inconsistency
- **Location:** `backlog.json` item `003` — description and `acceptanceCriteria[3]/[4]`
- **What's wrong:** Authoritative signature `02-schema-and-validation.md` §3.1 (L369) is `assertOutputValid(svg: string): void` — single arg; it parses internally and calls `assertStructural(svg, doc)` (L372, L467) which reads viewBox/width/height from the SVG itself. Item 003 specifies a two-arg `assertOutputValid(svg, {width,height})`, contradicted by item 009 AC and `08 §4.2`, which call `assertOutputValid(svg)`.
- **Suggested fix:** Change item 003 to `assertOutputValid(svg: string): void` (no dimensions object) plus `assertStructural(svg, doc)`. Reword AC #3/#4 to drop `{width,height}` and assert the structural check reads viewBox+width+height from the SVG markup.
- **References:** `02-schema-and-validation.md` §3.1 (L369-372), §3.4 (L467); `08-testing-strategy.md` §4.2; item 009
- **Checklist:** CHECK-B (AC correctness / spec consistency)

### V-004 — Item 012 acceptance criteria omit the PNG-to-stdout → USAGE_ERROR rule
- **Severity:** gap
- **Location:** `backlog.json` item `012` — `acceptanceCriteria`
- **What's wrong:** `05-cli-and-invocation.md` §2.3/§3.4 (L226, L398, L545) makes "refuse PNG to stdout with `DiagramUsageError` → exit USAGE_ERROR (64)" a contract behavior, tested in `08 §7.3` (`expect(code).toBe(EXIT_CODES.USAGE_ERROR)`). Item 012 mentions stdout precedence only generically; no AC names this refusal, so an agent could stream binary PNG to stdout and pass every listed AC while breaking item 018's test.
- **Suggested fix:** Add AC to item 012: "`--format png` (or `both`) with no output target (would stream to stdout) is refused with `DiagramUsageError` → exit USAGE_ERROR (64); no binary written to stdout." Reflect in the stdout-precedence sentence of the description.
- **References:** `05-cli-and-invocation.md` §2.3/§3.4 (L226, L398, L545); `08-testing-strategy.md` §7.3; item 018
- **Checklist:** CHECK-B (AC completeness)

### V-005 — Item 009 (svg-postprocess) is the largest single module yet estimated at 1 iteration
- **Severity:** improvement
- **Location:** `backlog.json` item `009` — `estimatedIterations: 1`
- **What's wrong:** Item 009 bundles seven distinct ordered passes (parse, color baking, z-order, legend, a11y, font embedding, canonicalization — `04-theme-postprocess-png.md` §3.1-§3.7), where canonicalization is "the linchpin of REQ-REPRO-01 byte-determinism." It is the shared finishing stage for both render paths yet estimated at 1, vs. item 012 (CLI) at 2. Independently completable (no split required) but the estimate risks a mid-iteration block.
- **Suggested fix:** Bump `estimatedIterations` to 2, or add a note that canonicalization (§3.7) may warrant a follow-up iteration if byte-determinism isn't achieved first pass.
- **References:** `04-theme-postprocess-png.md` §3.1-§3.7; item 012
- **Checklist:** CHECK-B (item scoping / iteration sizing)

### V-006 — `render.ts` (011) declares a spurious dependency on `png.ts` (010); the real consumer is `cli.ts` (012)
- **Severity:** inconsistency
- **Location:** `backlog.json` item `011` (`dependsOn:["006","007","009","010","003"]`) and item `012` (`dependsOn:["011","002"]`); plus item 011's unresolved notes
- **What's wrong:** `03-rendering-engine.md` (L522-527, L546-547, L707) is explicit that `render.ts` never imports/invokes `png.ts` ("`render` never calls `png.ts`"); PNG is produced by the CLI via `renderPng(svg)` (`05 §3.3`, L350-353). So the `010` edge is attached to the wrong item — it belongs on item 012. Build order is not broken (010 stays transitively before 012 via 011), but the declared graph contradicts the actual import graph. Item 011's notes leave this "unresolved" though the specs resolve it unambiguously.
- **Suggested fix:** Remove `"010"` from item 011 (→ `["006","007","009","003"]`); add `"010"` to item 012 (→ `["011","010","002"]`). Rewrite item 011's notes: "PNG is produced by the CLI (012) from RenderResult.svg, not inside render(); png.ts is a dependency of item 012, not this item (03 §5 L546-547, 05 §3.3)."
- **References:** `03-rendering-engine.md` L522-527/546-547/707; `05-cli-and-invocation.md` §3.3 (L350-353); `01-architecture-layout.md` §3 import graph
- **Checklist:** CHECK-B (dependency correctness)

### V-007 — `svg-postprocess.ts` (009) imports the font asset from item 001 but does not declare 001 as a dependency
- **Severity:** improvement
- **Location:** `backlog.json` item `009` (`dependsOn:["008","003"]`)
- **What's wrong:** `04-theme-postprocess-png.md` L441 shows `svg-postprocess.ts` importing the font data-URI from `./assets/font.subset.js` (authored in item 001). 009 doesn't list 001. Not a build-order break (001 is transitive via 009→003→002→001), but the direct module dependency is undeclared.
- **Suggested fix:** Optionally add `"001"` to item 009's `dependsOn` (→ `["008","003","001"]`). Low priority — transitivity already enforces ordering.
- **References:** `04-theme-postprocess-png.md` L420/441/636; item 001
- **Checklist:** CHECK-B (declared deps match import graph)

### V-008 — Font-asset export name differs between item 001 and the spec
- **Severity:** inconsistency
- **Location:** `backlog.json` item `001` (exports `SUBSET_FONT_DATA_URI`) vs `04-theme-postprocess-png.md` L441 (imports `FONT_SUBSET_DATA_URI`)
- **What's wrong:** Item 001 names the exported font data-URI constant `SUBSET_FONT_DATA_URI`, but the spec's consumer (svg-postprocess, L441) imports `FONT_SUBSET_DATA_URI`. The names must match or item 009's import breaks.
- **Suggested fix:** Align both on the spec's name `FONT_SUBSET_DATA_URI` — update item 001's description/AC to export that identifier.
- **References:** `04-theme-postprocess-png.md` L441; item 001 acceptance criteria; item 009
- **Checklist:** CHECK-B (declared deps / interface naming consistency)

### V-009 — PRD requirements traced only at whole-document granularity; ~9+ P0 requirements unnamed by their implementing item
- **Severity:** gap
- **Location:** `backlog.json` — every item's `specReferences`; cross-ref `TRACEABILITY.md`
- **What's wrong:** `specReferences` point at whole spec docs, never at the section/requirement. These REQs are not named in the item that delivers them: REQ-IN-01, REQ-IN-02, REQ-COV-01, REQ-COV-02, REQ-REL-02, REQ-THEME-01, REQ-INV-01/02/03, REQ-PORT-01, REQ-USE-01, CON-01, CON-03. The work exists (e.g. REQ-THEME-01 → 008; CON-01 → 015), so this is a traceability gap, not a coverage gap — but a loop agent has no per-item signal that a given requirement was satisfied, and a regression wouldn't surface against any single item's AC.
- **Suggested fix:** Add a `requirementRefs` array per item (or extend `specReferences` to `doc#section`) naming the REQ/CON IDs each item discharges, sourced from `TRACEABILITY.md`. Minimum mapping: 002→REQ-IN-02,REQ-REL-02; 003→REQ-IN-02,REQ-REL-01/02; 005→REQ-COV-01/02,REQ-OUT-01; 007→REQ-COV-02,REQ-OUT-02; 008→REQ-THEME-01; 009→REQ-COV-01,REQ-A11Y-01,REQ-OUT-04,REQ-REPRO-01,REQ-PORT-01; 011→REQ-REL-01/02; 012→REQ-INV-02/03/04,REQ-SEC-01; 013→REQ-IN-01/03,REQ-INV-01,REQ-USE-01; 015→REQ-PORT-02,CON-01; 016→REQ-COV-01/02,REQ-THEME-01.
- **References:** `TRACEABILITY.md`; `PRD.md` (23 REQ + 3 CON); `01-architecture-layout.md` §1
- **Checklist:** CHECK-B (every REQ-* covered by ≥1 item / items trace to real spec sections)

### V-010 — Item 004 and the `01` directory tree mis-cite schema-gen as `02 §4` (it is `02 §5`)
- **Severity:** error
- **Location:** `backlog.json` item 004 description ("per 02 §4–5"); `01-architecture-layout.md` §1 tree comments `schema-gen.ts (02 §4)` and `diagram-input.schema.json (02 §4)`
- **What's wrong:** In `02-schema-and-validation.md`, §4 = "REQ-IN-03 is NOT machine-validatable"; §5 = "schema-gen.ts". Item 004 implements schema-gen, so only §5 is relevant; "§4–5" pulls in the unrelated REQ-IN-03 note. The off-by-one appears twice in the 01 tree comments.
- **Suggested fix:** Item 004 description: "§4–5" → "§5" (plus `06 §3`). Fix both `(02 §4)` comments in `01-architecture-layout.md` §1 → `(02 §5)`.
- **References:** `02-schema-and-validation.md` §4 (L584) vs §5 (L599); `06-integration-and-packaging.md` §3
- **Checklist:** CHECK-B (items trace to real spec sections)

### V-011 — `01` directory-tree comments mis-label render-module sections
- **Severity:** inconsistency
- **Location:** `01-architecture-layout.md` §1 tree: `graph-render.ts (03 §2)`, `sequence-svg.ts (03 §3)`
- **What's wrong:** Actual headers are `graph-render.ts = 03 §3` and `sequence-svg.ts = 03 §4`. Items 006/007 cite the sections correctly ("03 §3", "03 §4"), so the spec's tree comments are stale, not the items. A reviewer cross-checking via 01 §1 hits a contradiction.
- **Suggested fix:** Correct the `01-architecture-layout.md` §1 tree comments: `graph-render.ts … (03 §3)`, `sequence-svg.ts … (03 §4)`. No backlog change needed.
- **References:** `03-rendering-engine.md` headers §3/§4; items 006, 007
- **Checklist:** CHECK-B (items trace to real spec sections)

### V-012 — Backlog verification should validate the spec file by explicit path (process note)
- **Severity:** improvement (verification-process; no artifact defect)
- **Location:** verification process / `rauf backlog validate` invocation
- **What's wrong:** `rauf backlog validate <path>` defaults to `<root>/.rauf/backlog.json`, which here is empty. The spec backlog is only validated when `--backlog specs/diagram-generator` is passed (which this run did). Without that flag, validation silently passes against the empty file — a false "valid" signal for future re-runs.
- **Suggested fix:** Always pass `--backlog specs/diagram-generator` (or add a draft-07 `jsonschema` check against `.rauf/backlog.schema.json`) when validating this feature's backlog. Both were done this run — recording the caveat for future maintainers.
- **References:** `.rauf/backlog.schema.json`; `.rauf/backlog.json` (empty); `forge.config.json` (`backlogDir:null`)
- **Checklist:** CHECK-B (backlog conforms to rauf schema)

---

## Fix Execution Plan

No fix requires a user decision — all are grounded in the authoritative specs. (V-002 moves a validation AC from item 011 to item 012; the spec already dictates this.)

### Step 1 — Correct item signatures to match the specs verbatim (V-001, V-002, V-003, V-008)
- **Files:** `backlog.json` (items 001, 003, 011)
- **Actions:**
  - Item 011: change `render` to `render(spec: DiagramSpec, opts: RenderOptions)`; remove in-`render` `parseSpec`/`DiagramInputError` AC (validation owned by CLI); keep `assertOutputValid` post-processing.
  - Item 003: change to `assertOutputValid(svg: string): void` + `assertStructural(svg, doc)`; drop `{width,height}` from AC.
  - Item 001: rename exported font constant to `FONT_SUBSET_DATA_URI`.
- **Root cause:** item descriptions paraphrase signatures from memory instead of transcribing the spec's exact exported signatures (items 002/005 already instruct "transcribe, do not redesign").

### Step 2 — Fix the dependency graph attribution (V-006, V-007)
- **Files:** `backlog.json` (items 009, 011, 012)
- **Actions:** Move `"010"` from item 011 → item 012 (011 → `["006","007","009","003"]`; 012 → `["011","010","002"]`); rewrite item 011 notes per V-006. Optionally add `"001"` to item 009.
- **Verify:** graph stays acyclic, single root 001, valid topo order.

### Step 3 — Add missing acceptance criterion (V-004)
- **Files:** `backlog.json` (item 012)
- **Action:** Add the PNG-to-stdout → USAGE_ERROR (64) refusal AC.

### Step 4 — Add per-item requirement traceability (V-009)
- **Files:** `backlog.json` (all items)
- **Action:** Add `requirementRefs` per item using the V-009 mapping from `TRACEABILITY.md`.

### Step 5 — Fix stale section citations in specs (V-010, V-011)
- **Files:** `backlog.json` (item 004), `01-architecture-layout.md` §1 tree
- **Actions:** item 004 "§4–5"→"§5"; `01` tree: `schema-gen (02 §4)`→`(02 §5)` ×2, `graph-render (03 §2)`→`(03 §3)`, `sequence-svg (03 §3)`→`(03 §4)`.

### Step 6 — Adjust scope estimate (V-005)
- **Files:** `backlog.json` (item 009)
- **Action:** Bump `estimatedIterations` to 2 or add canonicalization follow-up note.

### Step 7 — Verification-process note (V-012)
- No artifact change; ensure `--backlog specs/diagram-generator` is used on re-validation.

---

## Fix Progress

- Step 1: [APPLIED] 2026-06-18 — Corrected signatures to match specs: item 011 `render(spec, opts: RenderOptions)` + removed in-render validation (V-001/V-002); item 003 `assertOutputValid(svg: string): void` (V-003); item 001 font export renamed `FONT_SUBSET_DATA_URI` (V-008).
- Step 2: [APPLIED] 2026-06-18 — Dependency graph fixed: moved `010` edge from item 011 → item 012; added explicit `001` dep to item 009; rewrote item 011 notes (V-006/V-007). Graph re-validated acyclic.
- Step 3: [APPLIED] 2026-06-18 — Added PNG-to-stdout → USAGE_ERROR (64) acceptance criterion + description note to item 012 (V-004).
- Step 4: [APPLIED] 2026-06-18 — Per-item requirement traceability recorded in each item's `notes` ("Requirements satisfied: …") rather than a new `requirementRefs` field, since the rauf backlog schema sets `additionalProperties:false` (V-009). Mapping sourced from TRACEABILITY.md.
- Step 5: [APPLIED] 2026-06-18 — Section citations corrected: item 004 "§4–5"→"§5"; 01-architecture-layout.md tree `schema-gen (02 §4)`→§5 ×2 (+ zod-to-json-schema dep row), `graph-render (03 §2)`→§3, `sequence-svg (03 §3)`→§4 (V-010/V-011).
- Step 6: [APPLIED] 2026-06-18 — item 009 `estimatedIterations` 1→2 with canonicalization follow-up note (V-005).
- Step 7: [APPLIED] 2026-06-18 — V-012 process note: backlog re-validated via explicit `--backlog specs/diagram-generator` AND draft-07 jsonschema (0 errors); rauf validate `valid:true`.

All 12 findings applied. Deterministic validation: rauf `valid:true` (0 findings), JSON Schema 0 errors.
