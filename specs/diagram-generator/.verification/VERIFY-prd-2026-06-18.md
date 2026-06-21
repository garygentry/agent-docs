# Verification Findings — diagram-generator (prd mode)

- **Feature:** diagram-generator
- **Mode:** prd
- **Date:** 2026-06-18
- **Artifacts verified:** `PRD.md` (against `.reference/research.md`, `.pipeline-state.json`, and consumer `../doc-site-plugin/PRD.md`)
- **Checks executed:** 15 of 15 — 10 pass, 5 fail
- **Findings:** 6 (4 gap, 2 inconsistency, 0 improvement, 0 error)

## Summary

The PRD is structurally sound: requirements carry unique IDs, priorities are
consistent, out-of-scope is explicit, no engine/technology decision has leaked in
(D2/Graphviz/direct-SVG correctly deferred to OQ-2), and it stays faithful to
`research.md`'s hard constraints (no runtime renderer, tier-2 plain-`<text>` SVG,
no view-time network).

All findings cluster on one theme: **the provider/consumer contract between
diagram-generator and doc-site-plugin is under-specified on the provider side.**
Because diagram-generator is implemented FIRST and doc-site-plugin builds against
its "released" contract, the contract surface diagram-generator promises must
cover everything the consumer's PRD (doc-site-plugin REQ-DIAG-03 / CON-05 / OQ-4)
assumes — and right now it does not.

---

## Findings

### V-001 — Contract surface narrower than consumer assumes
- **Severity:** inconsistency
- **Location:** `PRD.md` §3.6 REQ-INV-03 and §7 OQ-3 vs. `../doc-site-plugin/PRD.md` §7 OQ-4
- **What's wrong:** doc-site-plugin OQ-4 declares the contract RESOLVED and
  enumerates four dimensions it depends on — *inputs, caller-specified output
  paths, exit behavior, and supported diagram types*. diagram-generator
  REQ-INV-03 / OQ-3 only commit **output locations** and **success/failure
  signaling**. Inputs and supported diagram types are not named as stable
  contract surface, so the consumer depends on more than the provider promises.
- **Suggested fix:** Expand REQ-INV-03 to enumerate the full contract surface the
  consumer relies on: (a) accepted input form(s) for the scriptable path,
  (b) caller-specified output path(s) and artifact format(s), (c) which diagram
  types are invocable non-interactively, (d) unambiguous exit/success-failure
  behavior. Align OQ-3's wording so the four dimensions it defers match the four
  doc-site-plugin OQ-4 enumerates (one-to-one).
- **References:** doc-site-plugin REQ-DIAG-03, CON-05, OQ-4
- **Checklist:** CHECK-P09 (cross-artifact consistency), CHECK-P11 (integration completeness)
- **⚠ Needs user decision:** see Fix Plan Step A (input-format intent).

### V-002 — No requirement makes the scriptable contract a stable/versioned interface
- **Severity:** gap
- **Location:** `PRD.md` §5 CON-02 and §3.6 REQ-INV-03
- **What's wrong:** CON-02 says the contract must be "stable enough for that
  consumer to depend on" — not testable. doc-site-plugin CON-05/OQ-4 build
  against the **released** contract, implying a versioned/stable interface, but no
  diagram-generator requirement asserts stability as a verifiable property.
- **Suggested fix:** Add **REQ-INV-04 (P0):** "The scriptable invocation contract
  (REQ-INV-03) MUST be a documented, stable interface — its input form, output
  path semantics, artifact formats, and exit codes constitute a published contract
  that downstream consumers (e.g. doc-site-plugin) may depend on; breaking changes
  require an explicit version bump." Add a matching success criterion (see V-005).
- **References:** CON-02, doc-site-plugin CON-05
- **Checklist:** CHECK-P07 (testable/measurable requirements)

### V-003 — PNG fallback role relative to consumer's image service unstated
- **Severity:** gap
- **Location:** `PRD.md` §3.3 REQ-OUT-03
- **What's wrong:** PNG rasterization is "opt-in," but the PRD never states whether
  the doc-site consumer needs PNG at all. doc-site-plugin uses a passthrough image
  service that assumes SVG diagrams; if PNG is never needed by that consumer, its
  P0/opt-in framing and build-dep implications should reflect that.
- **Suggested fix:** State the PNG artifact's intended consumer/use (universal
  fallback for non-SVG-capable destinations) and clarify it is NOT required by the
  doc-site-plugin path (which consumes SVG). Confirm PNG stays opt-in and out of
  the default doc-site integration.
- **References:** REQ-OUT-01, doc-site-plugin REQ-CORE-03 (passthrough image service)
- **Checklist:** CHECK-P11 (integration completeness)
- **⚠ Needs user decision:** see Fix Plan Step A (is PNG a v1 consumer need?).

### V-004 — "Professional quality bar" not testable
- **Severity:** gap
- **Location:** `PRD.md` §3.2 REQ-COV-01
- **What's wrong:** "professional quality (semantic component coloring,
  non-overlapping layout, readable labels, correct arrow routing/z-order)" lists
  desirable traits but no verifiable acceptance — "professional" is subjective.
- **Suggested fix:** Reframe as checkable properties, e.g. "emitted diagrams MUST
  have no overlapping component boxes, arrows routed behind boxes (z-order),
  labels within their containers, and a legend (when present) outside all boundary
  boxes" — mirroring the concrete craft rules in `research.md` §B/§Where it's
  strong. These are inspectable in the validation gate (REQ-REL-01).
- **References:** research.md (Cocoon-AI craft rules), REQ-REL-01
- **Checklist:** CHECK-P07 (testable acceptance)

### V-005 — Success criteria miss two requirement clusters
- **Severity:** gap
- **Location:** `PRD.md` §8 Success Criteria vs §4.1 REQ-PORT-02, §4.3 REQ-REPRO-01
- **What's wrong:** No success criterion covers REQ-PORT-02 (agent-agnostic
  equivalence across the five targets) or REQ-REPRO-01 (diffable regeneration from
  structured spec). Every requirement cluster should be observable in §8.
- **Suggested fix:** Add success criteria: (a) "The skill emits to and behaves
  equivalently across all five agent targets via `bun run build`" — partially
  present (last bullet covers emission; add behavioral equivalence), and
  (b) "Regenerating from an unchanged structured spec produces a stable artifact
  (diff-clean)." If V-002 is accepted, also add: "The scriptable contract is
  documented and a consumer (doc-site-plugin prebuild) invokes it successfully."
- **References:** REQ-PORT-02, REQ-REPRO-01, REQ-INV-04 (proposed)
- **Checklist:** CHECK-P13 (success criteria coverage)

### V-006 — "Structured specification" intent entangled with deferred engine choice
- **Severity:** inconsistency
- **Location:** `PRD.md` §3.1 REQ-IN-02 vs §7 OQ-2 and §4.4 REQ-USE-01
- **What's wrong:** REQ-IN-02 asserts a user-facing "structured specification" as a
  resolved P0, but whether that spec is an **engine-neutral schema** or a
  **raw engine DSL** is entangled with OQ-2 (generation strategy/engine, deferred).
  There's also latent tension with REQ-USE-01 ("no DSL required"): a structured
  input that IS a DSL would contradict the usability promise.
- **Suggested fix:** Clarify REQ-IN-02 that the structured input is an
  **engine-neutral** specification (nodes/edges/containers) whose concrete schema
  is defined in the tech spec — NOT the underlying engine's DSL — so it stays
  decoupled from OQ-2 and consistent with REQ-USE-01. Optionally note in OQ-2 that
  the engine choice must not force users to learn the engine's native DSL.
- **References:** OQ-2, REQ-USE-01
- **Checklist:** CHECK-P09 (internal consistency)
- **⚠ Needs user decision:** see Fix Plan Step A (engine-neutral schema vs DSL).

---

## Fix Execution Plan

A fresh agent can apply these in order. **Step A requires user decisions first.**

### Step A — Resolve open product decisions (RESOLVED 2026-06-18)
1. **Input format (V-001, V-006):** RESOLVED → the structured specification is an
   **engine-neutral schema** (nodes/edges/containers), decoupled from OQ-2,
   consistent with REQ-USE-01's no-DSL promise.
2. **PNG need (V-003):** RESOLVED → **PNG is a required v1 artifact** (standard
   output alongside SVG, not opt-in). doc-site-plugin still consumes SVG; PNG
   serves non-SVG destinations.

### Step B — Tighten the provider/consumer contract (V-001, V-002)
- Expand **REQ-INV-03** to enumerate the full contract surface (inputs, output
  paths/formats, invocable diagram types, exit behavior).
- Add **REQ-INV-04 (P0)**: scriptable contract is a documented, stable, versioned
  interface.
- Rewrite **OQ-3** so its deferred dimensions map one-to-one to doc-site-plugin
  OQ-4's four enumerated dimensions.

### Step C — Make fuzzy requirements testable (V-004, V-006)
- Reframe **REQ-COV-01** quality bar as inspectable properties (no overlaps,
  arrow z-order, labels-in-container, legend-outside-boundaries).
- Clarify **REQ-IN-02** per Step A decision (engine-neutral schema), note in OQ-2.

### Step D — Clarify PNG role (V-003)
- Per Step A decision, state PNG's intended consumer and that it's out of the
  default doc-site SVG path.

### Step E — Close success-criteria coverage (V-005)
- Add criteria for agent-agnostic behavioral equivalence (REQ-PORT-02), diffable
  regeneration (REQ-REPRO-01), and (if V-002 accepted) consumer-invokes-contract.

### Cross-feature note
None of these require editing doc-site-plugin: its OQ-4 already points at the
diagram-generator spec as authoritative. Fixing V-001/V-002 here makes that
pointer accurate. Re-verify is not required for doc-site-plugin.
