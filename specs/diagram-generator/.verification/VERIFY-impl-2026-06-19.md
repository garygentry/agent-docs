# Verification Findings — diagram-generator (impl)

- **Feature:** diagram-generator
- **Mode:** impl
- **Date:** 2026-06-19
- **Verifier dispatch:** 4 parallel `forge-verifier` instances (requirement-coverage, integration, testing, code-quality)
- **Gate status at verification:** `bun run gate` green — **444 tests pass**, `schema:check:diagram` clean, `build:diagram:check` clean (bundle in sync)
- **Findings count:** 4 (0 error, 0 gap, 2 inconsistency, 2 improvement)

## Verdict

The shipped `src/diagram/` implementation satisfies every PRD requirement and spec contract checked. The requirement-coverage dimension returned **zero** findings — all of REQ-OUT-01..04, REQ-COV-01/02, REQ-IN-*, REQ-REL-01/02 (including the corrected "render() does not re-validate" decision), REQ-THEME-01, REQ-A11Y-01, REQ-REPRO-01 byte-determinism, REQ-INV-01..04, REQ-SEC-01/02, and the PNG-to-stdout→USAGE_ERROR(64) rule were confirmed against live code and behavioral smoke tests. Integration (import-graph boundaries, exact devDep pins, gate wiring, single ToolEntry, emission to all 5 targets, zero-install bundle) is correct. No error- or gap-severity issues exist. **No fix is required before proceeding to docs**; the four findings below are optional hardening/doc-reconciliation.

---

## Findings

### V-001 — Spec 06 §4.3/§5.3 `SAMPLE_RELPATHS` model is stale vs the (correct) implemented emission/golden split
- **Severity:** inconsistency (spec-text drift; implementation is correct)
- **Location:** `specs/diagram-generator/06-integration-and-packaging.md` §4.3, §5.3 vs `src/test/golden.shared.ts:34-64`
- **What's wrong:** Spec 06 §5.3 mandates each target's `SAMPLE_RELPATHS` contain five diagram relpaths (SKILL file + both `references/*.md` + `scripts/diagram-render.mjs`), and §4.3 (OTQ-1) argues the `.mjs` relpath must live in `SAMPLE_RELPATHS` with a committed byte golden checked by `golden.test.ts`. The implementation registers only the transformed SKILL file per target — and is **correct** to do so: `golden.test.ts` asserts over `emit().files` (transformed outputs); a skill's verbatim owned subtree (`references/*`, `scripts/diagram-render.mjs`, exec-mode) is pinned by the whole-tree `build:check` against the committed `adapters/<target>/` trees, with bundle bytes additionally guarded by `build:diagram:check`. Spec 06 §5.4 explicitly authorizes this. So byte fidelity of the `.mjs` is fully enforced; only §4.3/§5.3 prose is now factually wrong.
- **Suggested fix:** Update 06 §5.3 to register only the transformed SKILL relpath per target in `SAMPLE_RELPATHS`, and rewrite §4.3/§5.3 to describe the actual split: transformed outputs pinned by `golden.test.ts`; verbatim subtree + bundle bytes pinned by `build:check` + `build:diagram:check`. Cite §5.4 as the authorizing clause. **No code change.**
- **References:** `src/test/golden.shared.ts:34-40` (authoritative rationale); 06 §5.4, §4.3, §5.3
- **Checklist:** CHECK-I01, CHECK-I09

### V-002 — `RENDER_FAILED` exit code is only asserted at constructor level, never exercised end-to-end
- **Severity:** improvement
- **Location:** `src/diagram/cli-contract.test.ts:120-133` (the `it.each` error-class mapping table)
- **What's wrong:** Spec §9's bar ("every `EXIT_CODES` entry asserted at least once") is met, but unevenly. INPUT_INVALID / IO_ERROR / USAGE_ERROR are exercised through real `main()` behavior; OUTPUT_INVALID and PNG_FAILED are proven at the validator/png boundary; but `RENDER_FAILED` (exit 3) is proven only by `new DiagramRenderError("x").exitCode === 3` — it asserts the constant table, not that any code path produces it. It is the one error code with zero behavioral coverage.
- **Suggested fix:** Add one negative case that drives a render-layer failure to a `RENDER_FAILED`/exit-3 outcome through `main()`; if no cheap trigger exists, feed a fault to the render throw site and assert `DiagramRenderError`/exit 3 propagates through `main()`'s catch (mirroring the §7.4 OUTPUT_INVALID boundary pattern). Use `EXIT_CODES.RENDER_FAILED`, never literal `3`.
- **References:** `08-testing-strategy.md` §7.4, §9; `src/diagram/schema.ts` (`RENDER_FAILED: 3`); `cli.test.ts:306-348`
- **Checklist:** CHECK-I (test strength / reject-path coverage)

### V-003 — Spec §7.4 OUTPUT_INVALID example claims a `render`-gate assertion; implementation asserts at the validator boundary
- **Severity:** inconsistency (spec-text vs implemented test; implemented approach is spec-sanctioned)
- **Location:** `src/diagram/cli-contract.test.ts:138-150` vs `08-testing-strategy.md` §7.4 note (~L769-775) and example (~L747-755, `renderWithForcedForeignObject()`)
- **What's wrong:** The §7.4 example frames the OUTPUT_INVALID proof as flowing through `render`'s `assertOutputValid` gate; the implementation instead feeds a synthetic `<foreignObject>` SVG straight to `assertOutputValid` and asserts `DiagramOutputError`/exit 4 — the exact fallback the spec's own §7.4 note endorses. It's a cleaner choice but does not prove the *failing* path is caught when it flows through `render`/`main()` (the passing case is covered by `property.test.ts:40-41`, which runs `assertOutputValid` over real `render` output).
- **Suggested fix:** Preferred (a): amend §7.4 prose/example to match the implemented boundary assertion (drop the `renderWithForcedForeignObject()` framing, since the note already sanctions it). Alternative (b): add a thin `main()`-level test proving the output gate is wired (inject a leaked `<foreignObject>` and assert exit 4 surfaces). Option (a) is lower-effort.
- **References:** `08-testing-strategy.md` §7.4 (L747-775); `src/diagram/property.test.ts:40-41`; `render.ts` (03 §5 gate)
- **Checklist:** CHECK-I (testing-strategy fidelity)

### V-004 — `canonNumberTokens` can corrupt SVG path-`d` arc-flag tokens (latent, not currently triggered)
- **Severity:** improvement
- **Location:** `src/diagram/svg-postprocess.ts:649-651` (`canonNumberTokens`), applied via `GEOMETRY_ATTRS` containing `"d"` at `serializeAttrs` (~L731)
- **What's wrong:** `canonNumberTokens` rewrites every numeric token in geometry attributes including path `d`. For elliptical-arc commands (`A`/`a`), the large-arc-flag and sweep-flag are positionally significant single digits that may appear without separators (e.g. `a5 5 0 0014 0`); re-tokenizing/rounding could alter flag grouping. Graphviz `dot` output for the in-scope shapes (box/ellipse/diamond/cylinder/polygon edges) does not emit `A` arcs, so this is **latent, not currently triggered** — no golden contains an arc, hence improvement not error.
- **Suggested fix:** Either (a) document in the `canonNumberTokens` doc comment that it assumes no SVG elliptical-arc (`A`/`a`) flag tokens in `d` (lowest risk, since Graphviz never emits them here), or (b) exclude `d` from numeric-token canonicalization and round path coordinates upstream at emission time. Verify no `__golden__/` SVG contains an `A`/`a` command either way.
- **References:** `dot-emit.ts` (no arc emission); `__golden__/` fixtures
- **Checklist:** CHECK-I (code-quality / canonicalization robustness)

---

## Fix Execution Plan

All four findings are optional (no error/gap severity). None blocks `forge-6-docs`. Two touch spec text only; two are code/test hardening.

### User Decisions Required
- **V-003** has two valid resolutions: (a) amend §7.4 spec prose to match the implemented boundary assertion [recommended — the spec's own note already sanctions it], or (b) add a `main()`-level wiring test. Confirm which before a fix agent edits spec text vs. test code.

### Step 1 — Reconcile spec text with the verified-correct implementation (V-001, V-003a)
- **Files:** `specs/diagram-generator/06-integration-and-packaging.md` (§4.3, §5.3); `specs/diagram-generator/08-testing-strategy.md` (§7.4)
- **Action:** 06 §5.3 → register only the transformed SKILL relpath per target; rewrite §4.3/§5.3 to describe the actual `golden.test.ts` (transformed `emit().files`) vs `build:check`/`build:diagram:check` (verbatim subtree + bundle bytes) split, citing §5.4. 08 §7.4 → drop the `renderWithForcedForeignObject()` framing; state OUTPUT_INVALID is proven by feeding a synthetic leak directly to `assertOutputValid`.
- **No code change.**

### Step 2 — Strengthen RENDER_FAILED coverage (V-002)
- **Files:** `src/diagram/cli-contract.test.ts` (or `cli.test.ts`)
- **Action:** Add a behavioral (or documented-boundary) test that produces a `RENDER_FAILED`/exit-3 outcome, using `EXIT_CODES.RENDER_FAILED`.

### Step 3 — Harden path-`d` canonicalization against arc flags (V-004)
- **Files:** `src/diagram/svg-postprocess.ts`
- **Action:** Document the no-arc assumption in `canonNumberTokens`, or exclude `d` from numeric-token canonicalization and round upstream. Confirm no `__golden__/` SVG contains an `A`/`a` command.

---

## Notes (not findings)
- REQ-COV-01's geometric properties ("no overlapping boxes", "labels contained in boxes") are delegated to the Graphviz layout engine by design (OQ-2 resolution) rather than asserted post-render — this matches the spec's verification checklist; no action needed.
- All 12 golden SVGs (6 types × {light,dark}) exist; property tests reuse `validate.ts` assertions (no re-implementation); determinism renders twice + compares to golden; PNG smoke checks magic bytes + dimension tolerance; CLI contract covers all four scriptable dimensions; emission guard asserts all 5 targets. No `.skip`/`.only`/`.todo` tests found.

---

## Fix Progress

### User Decisions Resolved
- **V-003** → option (a): amend §7.4 spec prose to match the implemented validator-boundary assertion (chosen by user, 2026-06-19). The spec's own §7.4 note already sanctioned this approach.

### Steps
- Step 1: [APPLIED] 2026-06-19 — Reconciled spec text with verified-correct implementation. 06 §4.3 rewritten: bundle byte-fidelity is pinned by `build:diagram:check` + whole-tree `build:check` (verbatim subtree in `emit().verbatim`), not a `SAMPLE_RELPATHS` byte golden. 06 §5.3 + its note rewritten to register only the transformed SKILL relpath per target; OTQ-1 coverage-table row updated. 08 §7.4 example rewritten to feed a synthetic `<foreignObject>` SVG directly to `assertOutputValid` (V-001, V-003).
- Step 2: [APPLIED] 2026-06-19 — Added an isolated end-to-end `RENDER_FAILED` wiring test in cli-contract.test.ts: mocks `./render.js` (via vi.doMock + dynamic cli import, resetModules-isolated) to throw `DiagramRenderError`, asserts `main()` returns `EXIT_CODES.RENDER_FAILED` with no partial artifact. Test count 444→445 (V-002).
- Step 3: [APPLIED] 2026-06-19 — Documented the no-arc (`A`/`a`) assumption in `canonNumberTokens` (svg-postprocess.ts) with the rationale (Graphviz never emits arcs for in-scope shapes) and the future-proofing instruction (V-004).

**Gate after fixes:** `bun run gate` green — 445 tests pass, schema:check:diagram clean, build:diagram:check clean, prettier clean. All 4 findings applied.
