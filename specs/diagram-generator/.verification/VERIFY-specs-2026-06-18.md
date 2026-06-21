# Verification Findings: diagram-generator — specs

- **Mode:** specs
- **Date:** 2026-06-18
- **Pipeline stage:** forge-3-specs complete (commit ce18861); forge-verify-specs run
- **Artifacts reviewed:** PRD.md, tech-spec.md, 00-core-definitions.md, 01-architecture-layout.md, 02-schema-and-validation.md, 03-rendering-engine.md, 04-theme-postprocess-png.md, 05-cli-and-invocation.md, 06-integration-and-packaging.md, 08-testing-strategy.md, TRACEABILITY.md
- **Method:** 5 parallel dimensioned forge-verifier instances (types/contracts, architecture/layout, cross-reference/traceability, testing, integration) + deterministic traceability validator. Findings merged, deduplicated, and renumbered.

## Summary

- **Total findings:** 17
- **Errors:** 1
- **Gaps:** 3
- **Inconsistencies:** 5
- **Improvements:** 8

**Deterministic traceability validator:** 23 requirements, 0 uncovered, 3 orphaned references (REQ-DISC-01, REQ-DISC-03, REQ-TOOLS-01) — all addressed below (V-010, V-011, V-012).

**Highest-priority finding:** V-001 (error) — the OTQ-1 "presence-only golden" resolution is mechanically incompatible with the real `golden.test.ts` set-equality and breaks `bun run gate` as written. Independently flagged by both the architecture and integration verifiers.

---

## Findings

### V-001: OTQ-1 "presence-only golden" resolution contradicts the actual `golden.test.ts` set-equality — breaks the gate
- **Severity:** error
- **Location:** 06-integration-and-packaging.md §4.3 (lines 220–247, esp. point 3 / the "Mechanically:" callout) and §5.3 (lines 364–369, 412–421); reinforced in 01-architecture-layout.md §6 and TRACEABILITY (OTQ-1 RESOLVED)
- **Issue:** The OTQ-1 resolution claims the `.mjs` relpath can be registered in `SAMPLE_RELPATHS` (the `wanted` set) **without** committing a `.mjs` golden, asserting `golden.test.ts:70-72` does the byte check and so "no byte assertion is made" on the bundle. This misreads the test. In `src/test/golden.test.ts`: `golden = readGolden(target)` walks **every committed** file (lines 31–43); line 76 asserts `emitted.keys() === golden.keys()` and line 78 asserts `golden.keys() === wanted`. This is a strict three-way equality `emitted == golden == wanted`. A relpath present in `wanted` but with no committed golden makes line 78 fail (golden omits it, wanted has it) AND line 76 fail (emitted has it, golden omits it). Conversely, committing a `.mjs` golden makes `readGolden`'s UTF-8 byte loop (line 39 + line 71 `.toBe`) byte-compare the WASM-inlined bundle — exactly the churn OTQ-1 set out to avoid. As written the spec leaves **no** passing option, and `bun run gate` (the central packaging guarantee) cannot pass.
- **Suggested fix:** Choose one and rewrite §4.3/§5.3 to match the real test: **(a)** commit a byte golden for `diagram-render.mjs` and drop all "presence-only / no byte compare" language (accepts golden churn on dependency bumps; `build:diagram:check` already pins bytes too); or **(b)** specify a concrete change to `golden.test.ts`/`golden.shared.ts` — e.g. a `PRESENCE_ONLY_RELPATHS` set excluded from the `golden.keys()` comparisons on lines 76/78 and skipped in `readGolden`'s byte loop — and add it to §06's "changes to existing packages" surface. Either way, correct the prose that attributes presence-enforcement to `:70-72` (it is actually the `:76`/`:78` set-equalities), consistent with §5.4 ("set equality is the source of truth").
- **References:** src/test/golden.test.ts:31-43,59-78; src/test/golden.shared.ts:34-40; 06 §4.3/§5.3/§5.4; 01 §6; OTQ-1
- **Checklist:** CHECK-S08, CHECK-S22, CHECK-S25, CHECK-S26, CHECK-S06
- **Detected by:** architecture + integration verifiers (merged)

### V-002: `postProcess` signature is contradictory between 03 and 04
- **Severity:** inconsistency
- **Location:** 04-theme-postprocess-png.md §3 (lines 267–271) vs 03-rendering-engine.md §5 (lines 510, 586–592, 609–614)
- **Issue:** Two mutually exclusive contracts for one exported function. 04 §3 declares `postProcess(rawSvg: string, spec: DiagramSpec, palette: ResolvedPalette): string` (three positional args, returns bare `string`). 03 §5's `render` calls `postProcess(rawSvg, { theme, accent, spec, width, height })` (two args, second an options object) and then reads `post.svg`, `post.width`, `post.height`, `post.slug` (an object, not a string). These cannot both be implemented. The return-shape conflict also blocks the `RenderResult` contract (00 §3.2), which sources `width`/`height`/`slug` from `post.*`. Additionally 04 line 611 says `render.ts` calls `resolveTheme` before `postProcess`, but 03's `render` never imports/calls `resolveTheme`.
- **Suggested fix:** Adopt the options-object form `postProcess(rawSvg: string, opts: { theme: Theme; accent?: HexColor; spec: DiagramSpec; width: number; height: number }): { svg: string; width: number; height: number; slug: string }` (matches 03's call site and `RenderResult`). Update 04 §3 signature, docstring `@param`/`@returns`, and §3.4/§3.7 prose. Decide who calls `resolveTheme` (render vs postProcess) and make 03 §5 + 04 line 611 agree; fix the `slug` ownership in one place.
- **References:** 00 §3.2 (RenderResult), 03 §5, 04 §1–§3/§3.4
- **Checklist:** CHECK-S10, CHECK-S12, CHECK-S17
- **Detected by:** types/contracts verifier

### V-003: `render` imports/calls `validateSpec`, but 02 defines no such symbol (it is `parseSpec`)
- **Severity:** inconsistency
- **Location:** 03-rendering-engine.md §5 (line 522 `import { validateSpec } from "./validate"`, line 563 `validateSpec(spec)`, lines 503/661/694) vs 02-schema-and-validation.md §2.4 (line 326 `export function parseSpec(raw: unknown)`)
- **Issue:** 03 imports/calls `validateSpec` from `./validate`, but 02 (owner of `validate.ts`) exports only `parseSpec(raw: unknown): DiagramSpec` and `diagramSuperRefine`. No `validateSpec` exists. The contracts also differ: `parseSpec` parses untrusted input and returns a `DiagramSpec`; 03 calls `validateSpec(spec)` on an already-typed value for side-effect only. 05 §3.1 already has the CLI call `parseSpec` before `render`, so re-validating in `render` is a redundant second parse.
- **Suggested fix:** Prefer removing the `validateSpec` import/call from 03 §5 entirely (validation happens at the CLI boundary per 05 §3.1) and update lines 503/522/563/661/694 + the dependency list. Alternatively add an explicit `export function validateSpec(spec: DiagramSpec): void` to 02 §2 (refine-only, distinct from `parseSpec`) and document it.
- **References:** 02 §2.4, 05 §3.1, 03 §5 (Dependencies + Verification)
- **Checklist:** CHECK-S10, CHECK-S11, CHECK-S12
- **Detected by:** types/contracts verifier

### V-004: `XmlElement` type used but never imported in 02
- **Severity:** gap
- **Location:** 02-schema-and-validation.md §3.4 (line 460–461) and §3.6 (line 560 `function hasDescendant(el: XmlElement, ...)`)
- **Issue:** Output-assertion code uses the type `XmlElement` as a parameter type, but only `parseXml` and `XmlDocument` are imported from `@rgrove/parse-xml` (line 386). `XmlElement` is referenced but never imported or declared, so `hasDescendant` will not type-check.
- **Suggested fix:** Add `XmlElement` to the import: `import { parseXml, type XmlDocument, type XmlElement } from "@rgrove/parse-xml";`. Fold into the existing "verify exact exported type names against the installed version" warning (lines 410–413), enumerating `XmlDocument`, `XmlElement`, the `.type === "element"` discriminant, and `.children`/`.attributes`/`.root`/`.name`.
- **References:** 02 §3.2/§3.4/§3.6
- **Checklist:** CHECK-S10, CHECK-S13
- **Detected by:** types/contracts verifier

### V-005: Inconsistent `./schema` vs `./schema.js` ESM import extensions across spec docs
- **Severity:** inconsistency
- **Location:** 03-rendering-engine.md (lines 203, 272, 465, 520–521) and 04-theme-postprocess-png.md (lines 53, 184–185, 243–245, 464, 522) use extensionless imports; 00/02/05 use `.js` (02 lines 86, 310–311, 353, 624; 05 lines 108, 193, 257)
- **Issue:** The suite is ESM (`"type": "module"`, 00 line 7), where relative imports require explicit `.js` at runtime under Node/Bun ESM resolution. 00/02/05 use `.js` consistently; 03/04 omit it. A fresh agent implementing 03/04 verbatim would produce non-resolving imports.
- **Suggested fix:** Normalize 03 and 04 to `.js`: `./schema`→`./schema.js`, `./errors`→`./errors.js`, `./theme`→`./theme.js`, `./validate`→`./validate.js`, `./dot-emit`→`./dot-emit.js`, `./graph-render`→`./graph-render.js`, `./sequence-svg`→`./sequence-svg.js`, `./svg-postprocess`→`./svg-postprocess.js`. Confirm the convention against 01 §3 and apply uniformly across all code-bearing docs.
- **References:** 00 line 7, 01 §3, 02/03/04/05 import blocks
- **Checklist:** CHECK-S17, CHECK-S10
- **Detected by:** types/contracts verifier

### V-006: `XmlDocument` vs `Document` external-type name disagreement within 02
- **Severity:** inconsistency
- **Location:** 02-schema-and-validation.md §3.1 prose (lines 380–381) vs §3.2 code (lines 386, 398)
- **Issue:** §3.1 prose says `parseXml` returns `import("@rgrove/parse-xml").Document`, but §3.2 code imports/uses `XmlDocument`. The doc asserts two different names for the same external type; a reader cannot tell which is authoritative.
- **Suggested fix:** Pick the name the pinned `@rgrove/parse-xml` actually exports and use it in both §3.1 and §3.2, resolving the existing WARNING at lines 410–413. (Combine with the V-004 import fix.)
- **References:** 02 §3.1/§3.2 (lines 380–413)
- **Checklist:** CHECK-S10, CHECK-S12
- **Detected by:** types/contracts verifier

### V-007: Internal `accent` widened to bare `string` while the contract type is `HexColor`
- **Severity:** improvement
- **Location:** 03-rendering-engine.md §5 `RenderOptions.accent?: string` (line 537); 04-theme-postprocess-png.md `resolveTheme(theme: Theme, accent?: string)` (line 206) + casts at lines 209–211 vs 00 §2.1 `HexColor` and 05 `ParsedArgs.accent?: HexColor` (line 130)
- **Issue:** `HexColor` is the validated branded contract type at the input boundary, but `RenderOptions.accent` and `resolveTheme` widen it back to `string` and then use `accent as ResolvedPalette["accent"]` casts. Not wrong (accent is validated upstream), but the widening loses the type guarantee end-to-end.
- **Suggested fix:** Type internal accent params as `HexColor` (import from `./schema.js`) in `RenderOptions` and `resolveTheme`, and drop the now-unneeded `as` casts in 04 §2.
- **References:** 00 §2.1, 04 §2, 05 §2.1
- **Checklist:** CHECK-S10, CHECK-S12
- **Detected by:** types/contracts verifier

### V-008: `src/diagram/build-check.ts` omitted from the "full" directory tree in 01 §1
- **Severity:** gap
- **Location:** 01-architecture-layout.md §1 "Directory tree (full)" (lines 22–71)
- **Issue:** The §1 tree is labeled "(full)" and is the canonical file-placement reference, but it omits `src/diagram/build-check.ts` — a real module that 06 §4.2 fully specifies and that `build:diagram:check` (01 §5 line 155) invokes via `bun run src/diagram/build-check.ts`. A fresh agent reading the authoritative tree would not create the file, and the gate's drift-guard step would fail.
- **Suggested fix:** Add a `build-check.ts` entry under `src/diagram/` in the §1 tree (e.g. `├── build-check.ts  # bundle drift guard (re-bundle in memory, diff) (06 §4.2)`) and note it in the §3 import-graph as a standalone script (like `schema-gen.ts`).
- **References:** 06 §4.2; 01 §5 line 155, §3
- **Checklist:** CHECK-S06, CHECK-S14, CHECK-S32
- **Detected by:** architecture verifier

### V-009: tech-spec §2 module tree not labeled illustrative vs 01 §1 authoritative
- **Severity:** improvement
- **Location:** tech-spec.md §2 module tree (lines 40–64) vs 01-architecture-layout.md §1
- **Issue:** tech-spec §2 omits `schema-gen.ts`, `build-check.ts`, and `assets/`, but is not labeled "illustrative" (unlike §4's data model). A reader may treat §2 as the layout contract and miss modules, compounding V-008.
- **Suggested fix:** Add one line to tech-spec §2 noting the tree is indicative and that 01 §1 is the authoritative full layout, or sync §2 to include the missing modules.
- **References:** tech-spec.md §2; 01 §1; V-008
- **Checklist:** CHECK-S05, CHECK-S06
- **Detected by:** architecture verifier

### V-010: Orphaned reference `REQ-TOOLS-01..04` in 06 unlabeled as an external (host-repo) requirement
- **Severity:** improvement
- **Location:** 06-integration-and-packaging.md §2 line 41 — inside the verbatim `ToolEntry` Zod block (`/** Tool kind (REQ-TOOLS-01..04). */`)
- **Issue:** The traceability validator flags `REQ-TOOLS-01` as ORPHANED. It is not a typo: it is a comment copied verbatim from host-repo `src/model.ts:41`, referencing the `agent-docs` emitter's own requirement vocabulary — a different namespace from this feature's PRD. Legitimate but reads as a diagram-generator requirement and trips the validator.
- **Suggested fix:** Do not edit the verbatim code comment. Add a one-line note in §2 (before the code block, near line 34) clarifying that `REQ-TOOLS-*`/`REQ-DISC-*` IDs inside the verbatim `src/model.ts` excerpt are the host emitter's own requirement IDs, not diagram-generator PRD requirements — mirroring the external-label precedent for REQ-DIAG-02 in TRACEABILITY.md line 7.
- **References:** 06 §2 lines 37–49; src/model.ts:37-48; TRACEABILITY.md line 7
- **Checklist:** CHECK-S14 (orphaned references); traceability-validator orphan REQ-TOOLS-01
- **Detected by:** cross-reference verifier

### V-011: Orphaned reference `REQ-DISC-01` in 06 unlabeled as an external (host-repo) requirement
- **Severity:** improvement
- **Location:** 06-integration-and-packaging.md §2 line 47 — verbatim `ToolEntry` block (`/** Per-target overrides/exclusions (REQ-DISC-01). */`)
- **Issue:** Same class as V-010. `REQ-DISC-01` is a verbatim host-repo comment referencing the emitter's discovery namespace, flagged ORPHANED. Legitimate but unlabeled.
- **Suggested fix:** Covered by the same clarifying note proposed in V-010 (it names both `REQ-TOOLS-*` and `REQ-DISC-*`). No code-comment edit.
- **References:** 06 §2 line 47; src/model.ts:47; V-010
- **Checklist:** CHECK-S14 (orphaned references); traceability-validator orphan REQ-DISC-01
- **Detected by:** cross-reference verifier

### V-012: Orphaned reference `REQ-DISC-03` occupies a coverage-table row in 02
- **Severity:** inconsistency
- **Location:** 02-schema-and-validation.md Requirement Coverage table (line 24: `| REQ-DISC-03 (analog) | JSON Schema generation + drift guard | 5 |`) and §5 heading (line 592)
- **Issue:** `REQ-DISC-03` is flagged ORPHANED. Unlike V-010/V-011 it is partly labeled ("analog"), but it sits as a **row key** in a `## Requirement Coverage` table — the traceability surface the validator and TRACEABILITY.md treat as PRD REQ→section mappings — so it pollutes the coverage namespace. The genuine PRD requirement this section discharges is **REQ-IN-02**, already co-listed, so REQ-DISC-03 carries no PRD-coverage weight.
- **Suggested fix:** Remove the `REQ-DISC-03 (analog)` row from the §02 coverage table (REQ-IN-02 already covers §5). Keep the mention in §5 prose/heading but reword to make it explicitly external: e.g. "mirrors the host emitter's manifest schema-gen requirement (`agent-docs` REQ-DISC-03); the PRD requirement discharged here is REQ-IN-02."
- **References:** 02 lines 24, 592–599; tech-spec.md §3.2; TRACEABILITY.md
- **Checklist:** CHECK-S14 (orphaned references / coverage-table integrity); traceability-validator orphan REQ-DISC-03
- **Detected by:** cross-reference verifier

### V-013: TRACEABILITY.md "No orphaned implementation details" claim contradicted by the validator
- **Severity:** improvement
- **Location:** TRACEABILITY.md lines 66–70 (Coverage summary) and line 7 (REQ-DIAG-02 external note)
- **Issue:** TRACEABILITY.md correctly maps all PRD requirements and externalizes REQ-DIAG-02, but claims "No orphaned implementation details" — now contradicted by the validator's three orphans (REQ-TOOLS-01, REQ-DISC-01, REQ-DISC-03). After V-010..V-012, the matrix should acknowledge them so the document and validator agree.
- **Suggested fix:** Extend the line-7 external-reference note into a short "External / host-repo requirement references" entry listing `REQ-TOOLS-*` / `REQ-DISC-*` (host emitter vocabulary, appearing in §06 verbatim code and §02 rationale) alongside REQ-DIAG-02 (doc-site-plugin consumer). Soften line 69 to "No diagram-generator PRD requirement is orphaned; all non-PRD IDs cited in specs are external references, listed above."
- **References:** TRACEABILITY.md lines 7, 66–70; V-010/V-011/V-012
- **Checklist:** CHECK-S14 (TRACEABILITY.md correctness)
- **Detected by:** cross-reference verifier

### V-014: Natural-language input path has no test mapping and no "untestable by design" note
- **Severity:** gap
- **Location:** 08-testing-strategy.md Requirement Coverage table (lines 26–42) and §9 (lines 797–814)
- **Issue:** PRD §8's first success criterion (PRD.md:200) requires "A natural-language description AND an equivalent structured spec each produce a valid, well-formed diagram artifact." 08 maps only the structured-spec half (`REQ-IN-02, REQ-REL-01 → §3, §4`). The natural-language half — **REQ-IN-01**, **REQ-INV-01**, **REQ-USE-01** (the prose→spec path in 05 §4) — appears nowhere in 08, and there is no explicit exclusion note. A reader cannot tell whether the NL path is deliberately out of automated-test scope or overlooked.
- **Suggested fix:** Add a §10 "Out of automated-test scope" subsection stating that REQ-IN-01 / REQ-INV-01 / REQ-USE-01 (the LLM-driven path in 05 §4) are validated by the SKILL.md procedure and human review, NOT by Vitest, because the inference step is non-deterministic (consistent with REQ-REPRO-01's caveat and OQ-1). Reference this exclusion from the coverage-table row for PRD §8's first criterion.
- **References:** PRD.md:200; TRACEABILITY.md:16,29,43; 05 §4
- **Checklist:** CHECK-S34, CHECK-S38
- **Detected by:** testing verifier

### V-015: `--type` override test does not assert the flag actually overrides the spec's `diagramType`
- **Severity:** improvement
- **Location:** 08-testing-strategy.md §7.4 "CLI invocable types" (lines 675–685)
- **Issue:** The dimension-3 test always passes `--type` equal to `fixture.spec.diagramType`, asserting exit 0. It proves the flag is accepted but never that it takes effect — a `main` that silently ignored `--type` would still pass. REQ-INV-03 dimension (c) ("which diagram types are invocable non-interactively") is under-tested.
- **Suggested fix:** Add a case where `--type` differs from (or is supplied with a spec lacking) `diagramType`, and assert the rendered artifact reflects the `--type` value (slug/golden or a type marker), or — if 05 defines `--type` as redundant-must-match — assert the conflict exit code. Make the override semantics from 05 §2/§3 explicit in at least one assertion.
- **References:** 05 §2–3; REQ-INV-03 dimension (c)
- **Checklist:** CHECK-S34
- **Detected by:** testing verifier

### V-016: Four fixtures (flowchart, er, state, dataflow) deferred with no per-fixture shape contract
- **Severity:** improvement
- **Location:** 08-testing-strategy.md §7.2 (lines 605–607)
- **Issue:** Only `architectureFixture` and `sequenceFixture` are specified; the other four are deferred with "follow the same graph shape as architectureFixture … Omitted here for brevity." Every table-driven suite (golden §3, property §4.2, determinism §5, CLI types §7.4) iterates `FIXTURES`, so these four are load-bearing for 12 goldens, yet a fresh implementer has no per-type minimal-validity contract. ER/state have type-specific cross-field rules in 02 §2 that "same graph shape as architecture" may not satisfy.
- **Suggested fix:** For each of the four, state (a) the minimal required fields per 02 §2's per-type cross-field invariants and (b) the one type-distinctive feature it must include (e.g. ER fixture must carry a relationship with cardinality; state fixture must carry initial+final states), so goldens actually exercise each type. A one-line-per-type table suffices.
- **References:** 02 §2; 08 §3/§4.2/§5/§7.4
- **Checklist:** CHECK-S35, CHECK-S37
- **Detected by:** testing verifier

### V-017: §5.2 cites `golden.shared.ts:30-33` for a note that lives elsewhere
- **Severity:** improvement
- **Location:** 06-integration-and-packaging.md §5.2 closing note (line 360): "consistent with the `SAMPLE_RELPATHS` note at `src/test/golden.shared.ts:30-33`"
- **Issue:** Lines 30–33 of `golden.shared.ts` are the tail of an extension/`.includes()` heuristic comment, not the `SAMPLE_RELPATHS` annotation (which begins at line 34). The substance of the claim (gemini is the only aggregate; codex emits no `agents/openai.yaml`) is supported by lines 31–32 + the inline comment at line 36 — citation-precision only, not a false claim.
- **Suggested fix:** Change the citation to `src/test/golden.shared.ts:31-32` (or `:31-39` to span the comment plus the codex note).
- **References:** src/test/golden.shared.ts:30-40
- **Checklist:** CHECK-S14, CHECK-S26
- **Detected by:** integration verifier

---

## Fix Execution Plan

### User Decisions Required

- **V-001 (blocking):** Choose the OTQ-1 resolution — **(a)** commit a byte golden for `diagram-render.mjs` (simpler; accepts churn on dependency bumps), or **(b)** add a presence-only relpath mechanism to `golden.test.ts`/`golden.shared.ts` (preserves OTQ-1 intent but requires specifying a real test change). The spec currently describes neither working option, so a fix cannot proceed without this choice.
  - **RESOLVED (2026-06-18):** Option **(a)** — commit a byte golden for `diagram-render.mjs`. §4.3/§5.3 rewritten so the `.mjs` relpath carries a committed byte golden (no test-code change), all "presence-only / no byte compare" language dropped, and citations corrected to the real set-equalities at `golden.test.ts:76,78` (byte loop is `:70-71`).
- **V-002 / V-003:** Confirm the canonical `postProcess` contract (recommended: options-object returning `{svg,width,height,slug}`) and the validation boundary (recommended: `render` does not re-validate; rely on the CLI's `parseSpec`). Recommended defaults are given; confirm before applying.
  - **RESOLVED (2026-06-18):** Recommended defaults accepted. `postProcess(rawSvg, { theme, accent?, spec, width, height }) → { svg, width, height, slug }`; `render` does not re-validate (relies on the CLI's `parseSpec`), so the nonexistent `validateSpec` import/call is removed from 03.

### Step 1 — Resolve OTQ-1 golden mechanism (V-001)
- **Files:** 06 §4.3, §5.3 (and 01 §6 / TRACEABILITY OTQ-1 note); if option (b), also specify changes to `src/test/golden.test.ts` + `golden.shared.ts`
- **Action:** Per the user's decision, rewrite §4.3/§5.3 so the described mechanism matches the real three-way equality at `golden.test.ts:76,78` (not the byte loop at `:70-72`). Add any test-code change to §06's "changes to existing packages" surface.
- **Depends on:** User decision (V-001)

### Step 2 — Unify the `postProcess` / `RenderResult` / validation contracts (V-002, V-003)
- **Files:** 04 (§1–§3, §3.4, Dependencies, Verification), 03 (§5 + prose at lines 50/503/510/522/563/609–614/661/694), optionally 02 §2
- **Action:** Adopt the options-object `postProcess` form and reconcile who calls `resolveTheme` and owns `slug`. Remove the nonexistent `validateSpec` import/call from 03 (or add an explicit `validateSpec` export to 02).
- **Depends on:** User decisions (V-002, V-003)

### Step 3 — Fix external-type references and ESM extensions in the code-bearing docs (V-004, V-005, V-006, V-007)
- **Files:** 02 (§3.1/§3.2/§3.6 + WARNING lines 410–413), 03 (imports + `RenderOptions`), 04 (imports + `resolveTheme` + casts)
- **Action:** Import `XmlElement`; unify the parsed-document type name across 02 §3.1/§3.2; normalize all relative imports in 03/04 to `.js`; type internal `accent` as `HexColor` and drop the casts.
- **Depends on:** none

### Step 4 — Complete the authoritative layout (V-008, V-009)
- **Files:** 01 §1 (+ §3), tech-spec.md §2
- **Action:** Add `src/diagram/build-check.ts` to the 01 §1 "(full)" tree and §3 import-graph; label tech-spec §2 as illustrative (or sync it).
- **Depends on:** none

### Step 5 — Clean up traceability / orphaned references (V-010, V-011, V-012, V-013)
- **Files:** 06 §2 (external-reference note), 02 (remove REQ-DISC-03 coverage row + reword §5), TRACEABILITY.md (external-reference note + soften line 69)
- **Action:** Label `REQ-TOOLS-*`/`REQ-DISC-*` as host-repo references without editing verbatim code; de-pollute the §02 coverage table; reconcile TRACEABILITY.md with the validator. Re-run the traceability validator after — it should report 0 orphans (or only explicitly-labeled externals).
- **Depends on:** none

### Step 6 — Close testing-strategy gaps (V-014, V-015, V-016, V-017)
- **Files:** 08 (§7.2, §7.4, §9, new §10 + coverage table), 06 §5.2 (citation)
- **Action:** Add the "out of automated-test scope" note for the NL path; add a meaningful `--type` override assertion; specify the four deferred fixtures' per-type shape contracts; fix the `golden.shared.ts` citation.
- **Depends on:** none

---

*Findings produced by 5 parallel forge-verifier instances + deterministic traceability validator, merged and deduplicated by the parent session. V-001 was independently flagged by two instances (architecture, integration) and merged.*

---

## Fix Progress

- Step 1: [APPLIED] 2026-06-18 — V-001 (decision a). Rewrote 06 §4.3 to commit a byte golden for `diagram-render.mjs` (dropped all "presence-only" language; corrected citations to the `:76`/`:78` set-equalities and the `:70-71` byte loop); updated 06 §4.3 heading, coverage-table OTQ-1 row, §5.3 note, Verification item, 01 §6 OTQ-1 note, and TRACEABILITY OTQ-1 row.
- Step 2: [APPLIED] 2026-06-18 — V-002/V-003. Adopted options-object `postProcess(rawSvg, { theme, accent?, spec, width, height }) → { svg, width, height, slug }` in 04 §3 (added `PostProcessOptions`/`PostProcessResult`; postProcess resolves the palette internally via `resolveTheme`); removed the nonexistent `validateSpec` import/call from 03 §5 (render trusts CLI's `parseSpec`); reconciled `resolveTheme` ownership (postProcess, not render) in 04 Dependencies; updated 03 §5.1/§5.2, dispatch flow, docstring, pipeline diagram, dependencies, and Verification.
- Step 3: [APPLIED] 2026-06-18 — V-004/V-005/V-006/V-007. Added `XmlElement` import in 02 §3.2 and consolidated the external-type verification WARNING; unified `XmlDocument` name in 02 §3.1 prose; normalized all relative imports in 03/04 to `.js`; typed internal `accent` as `HexColor` in 03 `RenderOptions` and 04 `resolveTheme`, dropping the `as` casts.
- Step 4: [APPLIED] 2026-06-18 — V-008/V-009. Added `build-check.ts` to the 01 §1 "(full)" tree and §3 import-graph; labeled tech-spec §2 module tree as indicative with 01 §1 authoritative.
- Step 5: [APPLIED] 2026-06-18 — V-010/V-011/V-012/V-013. Added the host-repo external-reference note to 06 §2; removed the `REQ-DISC-03 (analog)` coverage-table row in 02 and reworded §5 heading/prose as external (PRD requirement = REQ-IN-02); extended TRACEABILITY external-reference note (REQ-TOOLS-*/REQ-DISC-*) and softened the coverage summary.
- Step 6: [APPLIED] 2026-06-18 — V-014/V-015/V-016/V-017. Added 08 §10 "Out of automated-test scope" for the NL path (REQ-IN-01/INV-01/USE-01) + coverage-table row; added a meaningful `--type` override-effect assertion in 08 §7.4; specified per-type shape contracts for the four deferred fixtures in 08 §7.2; corrected the `golden.shared.ts` citation in 06 §5.2 to `:31-32`. Also reconciled 08 §2.1/§8-point-3 bundle-golden wording with the V-001 decision (a).
