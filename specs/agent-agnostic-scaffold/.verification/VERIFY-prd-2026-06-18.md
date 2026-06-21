# Verification Findings — agent-agnostic-scaffold (prd mode)

- **Feature:** agent-agnostic-scaffold
- **Mode:** prd
- **Date:** 2026-06-18
- **Artifact verified:** `PRD.md`
- **Checks executed:** 15 of 15 — 9 pass, 6 fail, 0 not-applicable
- **Findings:** 6 (4 gap, 1 inconsistency, 1 improvement, 0 error)
- **User decisions required before fixing:** V-001 (does the drift guard re-apply overrides before diffing?), V-004 (is "MUST run in CI" a deliberately-placed functional mandate, or should it move to Constraints?)

This is a mature PRD (9/15 clean). Findings skew toward precision and contract tension rather than missing scope. The load-bearing items are the implicit tensions between the override-merge requirement and the byte-stability/drift-guard guarantees.

---

## Findings

### V-001 — Byte-stability contract omits override slots as an input
- **Severity:** gap
- **Location:** PRD.md §3.4 Emitter / Transform — REQ-EMIT-06 (also §4.3 REQ-REL-01, §3.5 REQ-VALID-01)
- **What's wrong:** REQ-EMIT-06 mandates byte-stable output — "the same canonical input MUST yield byte-for-byte identical adapter files on every run." REQ-EMIT-04 introduces per-target override slots that the emitter merges into generated output. The determinism/byte-stability contract is written purely in terms of "canonical input" and never names the override slots as a second input to the emit. As written, the guarantee is under-specified: it neither states that identical *canonical-input-plus-overrides* yields identical output, nor that the drift guard (REQ-VALID-01) must re-apply overrides before diffing. If the drift guard re-emits from canonical only and diffs against committed adapters that contain merged overrides, every override produces a false-positive drift failure. This is the load-bearing contract tension for the whole feature: the override-merge requirement and the byte-stability requirement reference disjoint input sets.
- **Suggested fix:** Amend REQ-EMIT-06 so the determinism clause names both inputs: "the same canonical input *and the same override-slot contents* MUST yield byte-for-byte identical adapter files." Add a clause to REQ-VALID-01 stating the drift guard re-emits *with overrides merged in the same way a normal build does* before diffing against committed adapters. Cross-reference REQ-EMIT-04 from both REQ-EMIT-06 and REQ-VALID-01.
- **References:** REQ-EMIT-04, REQ-EMIT-05, REQ-VALID-01, REQ-REL-01, SC-03, SC-05
- **Checklist:** CHECK-P15, CHECK-P12

### V-002 — No requirement for stale-output cleanup on tool removal/rename
- **Severity:** gap
- **Location:** PRD.md §3.4 (REQ-EMIT-05 idempotency) and §3.5 (REQ-VALID-01 drift guard)
- **What's wrong:** No requirement covers the lifecycle case where a tool (or manifest entry) is *removed* or *renamed*. REQ-EMIT-05 mandates idempotency and "MUST NOT require manual cleanup between runs," but an idempotent emitter that only writes/overwrites and never deletes will leave stale adapter files in `adapters/` after a tool is removed from the canonical source/manifest. Those orphaned files are not re-emitted, so the drift guard may miss them — or the stale files silently persist as committed output that no longer has a canonical source, defeating the single-source-of-truth guarantee (REQ-STRUCT-03, REQ-DISC-02). Deletion/rename is a first-class lifecycle operation for committed codegen and is currently unspecified.
- **Suggested fix:** Add a new P0 functional requirement (e.g. REQ-EMIT-08) under §3.4: "When a tool is removed or renamed in the canonical source/manifest, a rebuild MUST remove the corresponding stale adapter files for every target so that `adapters/` contains exactly the set of files the current canonical source would emit (no orphans)." Add a companion clause to REQ-VALID-01 so the drift guard fails when committed adapters contain files with no corresponding canonical source (orphan detection), not only when contents differ. Add a Success Criterion mirroring SC-04 for deletion.
- **References:** REQ-EMIT-05, REQ-EMIT-06, REQ-STRUCT-03, REQ-DISC-02, REQ-VALID-01, SC-03, SC-04
- **Checklist:** CHECK-P14, CHECK-P12

### V-003 — Best-effort fallback requirement is not testable as written
- **Severity:** gap
- **Location:** PRD.md §3.4 REQ-EMIT-03 (best-effort fallback) and §3.5 REQ-VALID-05 (coverage report)
- **What's wrong:** REQ-EMIT-03 uses "best-effort fallback (the nearest representable equivalent ... where possible), and MUST warn where no faithful representation exists." The phrases "best-effort," "nearest representable equivalent," and "where possible" are judgment calls with no objective pass/fail an implementer or reviewer can verify. The genuinely testable obligation — that every construct which maps, falls back, or is skipped produces a corresponding coverage-report entry — is entangled with the un-testable quality judgment, so neither is cleanly verifiable.
- **Suggested fix:** Split REQ-EMIT-03 into (a) a hard, testable requirement and (b) a soft, judgment requirement. Hard: "For every Claude construct with no faithful target equivalent, the emitter MUST emit a coverage-report entry classifying it as fallback or skipped, and MUST emit a warning — there are no silent drops" (ties to REQ-VALID-05/REQ-OBS-01). Soft: keep the "best-effort nearest representable equivalent where possible" language explicitly framed as a non-acceptance-gating design goal. Cross-reference REQ-VALID-05 and REQ-OBS-01 from the hard clause.
- **References:** REQ-VALID-05, REQ-OBS-01, REQ-OBS-02, SC-06
- **Checklist:** CHECK-P08, CHECK-P06

### V-004 — "MUST run in CI" is a delivery mandate placed inside Functional Requirements
- **Severity:** inconsistency
- **Location:** PRD.md §3.5 REQ-VALID-02 vs §5 Constraints
- **What's wrong:** REQ-VALID-02 ("The drift guard MUST run in CI and fail the build on drift") is a delivery/operational mandate inside the Functional Requirements section. A functional requirement should state *what* the system does (drift is detected and fails); *where it runs* (CI) is a delivery constraint. This duplicates REQ-VALID-01 ("runnable both locally and in CI") and splits one guard's contract across a functional requirement and what is effectively a constraint — inconsistent with CON-02 ("Adapters MUST be committed in-repo ... to keep them ... CI-guardable"), which is the same class of operational mandate but lives in §5.
- **Suggested fix:** Confirm with the user before auto-rewording (project convention on delivery-mandate placement). If confirmed for relocation: fold the CI-execution obligation into §5 Constraints (extend CON-02 or add a CI-gating CON) and reduce REQ-VALID-02 to the functional assertion that drift detection fails the build, cross-referencing the constraint. If the user prefers it stay functional, add a note to REQ-VALID-02 explicitly reconciling it with REQ-VALID-01 so the overlap is documented as intentional.
- **References:** REQ-VALID-01, CON-02, SC-04
- **Checklist:** CHECK-P09, CHECK-P12

### V-005 — Overrides not required to be guard-distinguishable from emitted content
- **Severity:** gap
- **Location:** PRD.md §3.4 REQ-EMIT-04 (override slots) and §7 Open Questions OQ-03
- **What's wrong:** REQ-EMIT-04 requires per-target override slots "merged into the generated output" that "MUST NOT be overwritten or lost by a rebuild," but the PRD never requires an override to be *detectably distinguishable* from emitted content in the committed tree. Without that, the drift guard cannot tell a legitimate override apart from a hand-edit of generated output — which SC-04 says must fail. SC-04 (hand-editing a committed adapter outside an override slot fails the guard) and SC-05 (a declared override survives rebuild) are only achievable if "outside an override slot" is a well-defined, machine-detectable boundary. OQ-03 defers *merge semantics* to the tech spec, but the PRD-level requirement that overrides be guard-distinguishable is a functional obligation, not an open question, and is absent.
- **Suggested fix:** Add a P0 clause to REQ-EMIT-04: "Override slots MUST be declared/located such that the drift guard can deterministically distinguish author-supplied override content from emitted content, so edits inside an override slot are honored while edits to emitted output are flagged as drift." Cross-reference SC-04/SC-05 and note OQ-03 still owns the concrete merge-semantics decision (file-level replace vs section merge).
- **References:** REQ-EMIT-05, REQ-EMIT-06, REQ-VALID-01, OQ-03, SC-04, SC-05
- **Checklist:** CHECK-P15, CHECK-P11, CHECK-P14

### V-006 — MVP success criteria depend on an unselected sample tool / golden output
- **Severity:** improvement
- **Location:** PRD.md §8 Success Criteria — SC-02 / SC-08, and §3.5 REQ-VALID-04
- **What's wrong:** SC-02 requires the MVP to emit "one real sample tool" correctly to all four targets, and SC-08 requires golden-snapshot and schema-validation checks to pass — but OQ-04 ("Which single sample tool ... and what does its 'correct' output look like for each target") is still open. The criteria are sound, but their pass/fail definition depends on an as-yet-unselected sample tool and undefined golden output. Not an error (OQ-04 legitimately defers the choice), but the criteria would be stronger if they named the acceptance artifact they depend on.
- **Suggested fix:** Add a forward-reference note to SC-02 and SC-08: "Evaluation of these criteria depends on the sample tool and per-target golden snapshots selected in OQ-04 (fixed in the tech spec); these criteria become testable once those golden files are checked in." Optionally tie SC-08 explicitly to REQ-VALID-04 so the golden-file mechanism and the success criterion reference each other.
- **References:** REQ-VALID-03, REQ-VALID-04, OQ-04, SC-02, SC-08
- **Checklist:** CHECK-P07, CHECK-P10

---

## Fix Execution Plan

A fresh agent with no prior context can apply these in order. Steps 1–2 require user decisions first.

**Step 0 — Resolve user decisions (blocking).**
- V-001: Confirm the drift guard re-emits *with overrides merged* before diffing (expected: yes). This determines the exact wording of the REQ-EMIT-06 / REQ-VALID-01 amendments.
- V-004: Confirm whether "MUST run in CI" stays in Functional Requirements (add reconciliation note) or moves to §5 Constraints.

**Step 1 — Determinism & override contract (V-001, V-005).** In §3.4, amend REQ-EMIT-06 to name both inputs (canonical input + override-slot contents). Add the P0 guard-distinguishability clause to REQ-EMIT-04. In §3.5, add to REQ-VALID-01 that the drift guard merges overrides the same way a build does before diffing. Cross-reference REQ-EMIT-04 ↔ REQ-EMIT-06 ↔ REQ-VALID-01 and SC-04/SC-05. Do these together — they all touch the override↔drift-guard boundary.

**Step 2 — Lifecycle / stale-output cleanup (V-002).** Add new P0 requirement REQ-EMIT-08 (tool removal/rename removes stale adapters; `adapters/` contains exactly the emitted set). Add orphan-detection clause to REQ-VALID-01. Add a deletion Success Criterion mirroring SC-04.

**Step 3 — Testable fallback (V-003).** Split REQ-EMIT-03 into a hard coverage-report-entry + warning requirement (cross-ref REQ-VALID-05/REQ-OBS-01) and a soft non-gating quality goal.

**Step 4 — CI mandate placement (V-004).** Apply per the Step 0 decision.

**Step 5 — Success-criteria forward references (V-006).** Add the OQ-04 dependency note to SC-02 and SC-08; tie SC-08 to REQ-VALID-04.

---

## User Decisions Required — Resolved

- **V-001:** RESOLVED — drift guard re-applies (merges) override slots before diffing. REQ-EMIT-06 names both inputs; REQ-VALID-01 mandates the merge.
- **V-004:** RESOLVED — CI mandate moved to §5 Constraints (new CON-05); REQ-VALID-02 reduced to the functional "fail the build on drift" assertion.

## Fix Progress

- Step 1: [APPLIED] 2026-06-18 — REQ-EMIT-06 names canonical+override inputs; REQ-EMIT-04 adds guard-distinguishability clause; REQ-VALID-01 mandates override-merge + orphan detection (V-001, V-005).
- Step 2: [APPLIED] 2026-06-18 — Added REQ-EMIT-08 (stale-output removal on tool delete/rename); REQ-VALID-01 orphan-detection; new SC-05a (V-002).
- Step 3: [APPLIED] 2026-06-18 — Split REQ-EMIT-03 into hard testable coverage-entry+warning requirement and REQ-EMIT-03a non-gating design goal (V-003).
- Step 4: [APPLIED] 2026-06-18 — CI mandate relocated to CON-05; REQ-VALID-02 reduced to functional fail-on-drift (V-004).
- Step 5: [APPLIED] 2026-06-18 — Added OQ-04 dependency notes to SC-02 and SC-08; tied SC-08 to REQ-VALID-03/04 (V-006).
