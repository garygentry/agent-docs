# Verification Report: doc-site-plugin (prd)

- **Date:** 2026-06-19
- **Pipeline Stage:** forge-2-tech (PRD stage forge-1-prd v2 complete)
- **Artifacts Reviewed:**
  - specs/doc-site-plugin/PRD.md
  - specs/doc-site-plugin/.reference/canon.md
  - specs/diagram-generator/05-cli-and-invocation.md (contract cross-check)
  - specs/doc-site-plugin/.pipeline-state.json
- **Checks Executed:** 15 of 15 (11 pass, 3 fail, 1 not-applicable)

## Per-check results

- CHECK-P01 pass · CHECK-P02 pass · CHECK-P03 pass · CHECK-P04 pass · CHECK-P05 pass
- CHECK-P06 pass · CHECK-P07 pass · CHECK-P08 pass · CHECK-P09 pass · CHECK-P10 pass
- CHECK-P11 fail · CHECK-P12 pass · CHECK-P13 pass · CHECK-P14 fail · CHECK-P15 fail
- Supplemental traceability validator: not-applicable (specs-mode tool; no impl specs exist yet)

**Cross-feature note:** OQ-4 is marked RESOLVED against the diagram-generator scriptable
contract. Confirmed that contract is real and concrete
(specs/diagram-generator/05-cli-and-invocation.md §1 enumerates Input/Output/Invocable
types/Exit-signaling; §1.4 plus `--version`/`CONTRACT_VERSION` for stability). The
RESOLVED claim and CON-05's "hard prerequisite, builds against released contract" are
faithful to the sibling spec. No contract-drift finding.

## Summary

- Total findings: 5
- Gaps: 3
- Inconsistencies: 1
- Improvements: 1
- Errors: 0

## Findings

### V-001: "Agent-agnostic equivalence" (REQ-PORT-02) has no verifiable equivalence criterion
- **Severity:** gap
- **Location:** PRD.md §4.3 REQ-PORT-02; related §2 last user story, §8 Success Criteria bullet 5
- **Issue:** REQ-PORT-02 requires the procedure to "behave equivalently when invoked through any of the five supported coding agents," and the success criterion only says it "emits cleanly to all five agent targets via `bun run build`." Neither defines what "equivalently" or "cleanly" means as a pass/fail bar. "Emits cleanly" (build pipeline succeeds) is verifiable; "behaves equivalently across 5 agents" at runtime is not — there is no stated equivalence test. A fresh agent cannot write an acceptance test for "behaves equivalently."
- **Suggested fix:** Add a concrete equivalence criterion to REQ-PORT-02, e.g. "Given identical interview answers, the emitted file set (config, scripts, CI, manifest) MUST be byte-identical regardless of which agent target drove the procedure; behavioral equivalence is verified by a golden-output comparison across the five emitted tool forms." Distinguish this build-time equivalence (testable) from runtime-conversational variation (inherently agent-dependent; call out as out of scope for the equivalence bar).
- **References:** PRD.md §4.3, §8; CON-02 (emission pipeline)
- **Checklist:** CHECK-P08, CHECK-P11, CHECK-P14

### V-002: Partial-failure / rollback behavior of the generator is unspecified
- **Severity:** gap
- **Location:** PRD.md §3.8 (REQ-VERIFY-01/02) and §3.7 (REQ-RERUN-01/02)
- **Issue:** REQ-VERIFY-02 covers the case where the emitted *build* smoke test fails. But the PRD never addresses what happens if the *generator itself* fails partway through emission (e.g. it has written `astro.config.mjs` and half the symlinks, then errors). Does it roll back, leave a half-scaffolded tree, or rely on idempotent re-run to recover? The diagram-generator sibling contract explicitly guarantees "no partial writes on any failure"; the consumer generator makes no analogous guarantee about its own multi-file emission. This is an implicit safety requirement adjacent to REQ-SEC-01 that is currently unstated.
- **Suggested fix:** Add a requirement under §3.8 (e.g. REQ-VERIFY-04) stating the generator's failure semantics for its own emission step — either (a) emission is transactional/cleaned-up on failure, or (b) emission is intentionally non-transactional and a failed run is recoverable by re-running per REQ-RERUN-01, with partial state explicitly flagged to the user. Pick one and state it; reference REQ-RERUN-01 if (b).
- **References:** PRD.md §3.7, §3.8, §4.2 REQ-SEC-01; specs/diagram-generator/05-cli-and-invocation.md §1 (no-partial-writes precedent)
- **Checklist:** CHECK-P14, CHECK-P08

### V-003: Monorepo workspace wiring is only implicit in REQ-PORT-01
- **Severity:** gap
- **Location:** PRD.md §4.3 REQ-PORT-01; canon.md "Reference Implementation" last table row, "The Generator's Job" item 2
- **Issue:** Canon explicitly calls out that the reference site requires root `package.json` passthrough scripts (`dev:docs`/`build:docs`) and `pnpm-workspace.yaml` workspace membership for the monorepo case. REQ-PORT-01 covers "scripts, CI, package manifest" and "monorepo vs single package," but never names the root-level workspace wiring (workspace-membership edit + root passthrough scripts) that a monorepo scaffold must emit. As written it could be read as only emitting the docs package itself, leaving it unregistered in the workspace.
- **Suggested fix:** Extend REQ-PORT-01 (or add REQ-PORT-03): "For monorepo targets, the generator MUST register the docs package in the workspace manifest (e.g. `pnpm-workspace.yaml`/`workspaces`) and emit root-level passthrough scripts (`dev:docs`/`build:docs` equivalents), matching the detected package manager." Reference canon.md's reference-implementation table row for root `package.json`/`pnpm-workspace.yaml`.
- **References:** canon.md reference-implementation table + Generator's-Job item 2; PRD.md §4.3
- **Checklist:** CHECK-P14, CHECK-P01

### V-004: Non-functional requirements are not quantified where they could be
- **Severity:** improvement
- **Location:** PRD.md §4 NFRs — specifically §4.1 REQ-REL-01, §4.4 REQ-USE-01
- **Issue:** Per CHECK-P11, NFRs should be quantified where applicable. Most NFRs here are appropriately qualitative because the substrate is an LLM-driven procedure (no latency/throughput SLA maps cleanly — expected for agent-authored tools in this repo). But a few have a quantifiable form left implicit: REQ-REL-01 idempotency ("no destructive churn") would be sharper as a zero-diff invariant; REQ-USE-01 "keep simple sites simple" is unmeasurable as written.
- **Suggested fix:** Tighten REQ-REL-01 to a measurable invariant ("re-run with identical inputs yields a no-op git diff in the target tree, modulo regenerated caches"). Either give REQ-USE-01 a concrete floor ("a minimal site MUST require answering no more than N interview questions and MUST emit zero optional-component files when all optional components are declined") or move the unmeasurable aspiration into design rationale. Do not invent latency/uptime SLAs — they don't apply here.
- **References:** PRD.md §4.1, §4.4; §8 Success Criteria (idempotency bullet)
- **Checklist:** CHECK-P11, CHECK-P05

### V-005: "Always latest versions" vs idempotency/reproducibility tension — re-run consequence unstated
- **Severity:** inconsistency
- **Location:** PRD.md §4.1 REQ-REL-02 vs REQ-REL-01; §3.7 REQ-RERUN-01; §7 OQ-1
- **Issue:** REQ-REL-02 resolves to the latest Astro/Starlight at scaffold time; REQ-REL-01 and REQ-RERUN-01 require idempotent re-runs with no destructive churn. These are in tension: a re-run after an upstream release could pull a newer Astro/Starlight and change emitted `package.json` version pins, colliding with "zero-diff re-run." OQ-1 flags the *forward* trade-off (pinned-fallback mode) but does not state how a re-run reconciles "always latest" with idempotency — i.e. whether a re-run re-resolves versions (breaking byte-idempotency) or preserves existing pins. This part is decidable now even with OQ-1 open.
- **Suggested fix:** Add one sentence to REQ-RERUN-01 (or REQ-REL-02): "On re-run the generator MUST preserve existing version pins rather than re-resolving to latest, so idempotency holds; version bumps are an explicit opt-in, not a side effect of re-run." Keep OQ-1 open for the pinned-fallback-mode decision. This is intentionally distinct from OQ-1 — do not fold it back into the open question.
- **References:** PRD.md §4.1, §3.7, §7 OQ-1
- **Checklist:** CHECK-P15, CHECK-P14

## Fix Execution Plan

### User Decisions Required
- **V-002:** [RESOLVED 2026-06-19] Recoverable-via-re-run (non-transactional emission; partial state flagged, recovered by re-run per REQ-RERUN-01).
- **V-005:** [RESOLVED 2026-06-19] Preserve existing version pins on re-run; version bumps are an explicit opt-in.

All other fixes (V-001, V-003, V-004) can be applied directly.

### Execution Steps

#### Step 1: Tighten verifiability of cross-agent equivalence and idempotency NFRs
- **Files:** PRD.md (§4.3 REQ-PORT-02, §4.1 REQ-REL-01, §4.4 REQ-USE-01, §8)
- **Addresses:** V-001, V-004
- **Checklist:** CHECK-P08, CHECK-P11, CHECK-P14, CHECK-P05
- **Action:** Add a byte-identical golden-output equivalence criterion to REQ-PORT-02 and the matching §8 success bullet; rewrite REQ-REL-01 as a zero-diff-re-run invariant; give REQ-USE-01 a concrete minimal-site bound (max question count + zero optional-component files when declined). Do not add latency/uptime SLAs.
- **Depends on:** none

#### Step 2: Add monorepo workspace-wiring coverage
- **Files:** PRD.md (§4.3 REQ-PORT-01, or new REQ-PORT-03)
- **Addresses:** V-003
- **Checklist:** CHECK-P14, CHECK-P01
- **Action:** State explicitly that monorepo targets get workspace-manifest registration plus root passthrough scripts, matching detected package manager; cite canon.md's root-package.json/pnpm-workspace.yaml reference row.
- **Depends on:** none

#### Step 3: Specify generator partial-failure semantics (after user decision)
- **Files:** PRD.md (§3.8, new REQ-VERIFY-04)
- **Addresses:** V-002
- **Checklist:** CHECK-P14, CHECK-P08
- **Action:** Per the user's choice, add a requirement stating either transactional/cleanup-on-failure emission, or non-transactional emission recoverable via REQ-RERUN-01 with partial state flagged. Mirror the diagram-generator "no partial writes" precedent if transactional.
- **Depends on:** User Decision (V-002)

#### Step 4: Resolve always-latest vs re-run idempotency tension (after user decision)
- **Files:** PRD.md (§3.7 REQ-RERUN-01 or §4.1 REQ-REL-02)
- **Addresses:** V-005
- **Checklist:** CHECK-P15, CHECK-P14
- **Action:** Add a sentence stating re-run preserves existing version pins (or re-resolves, per decision); leave OQ-1 open for the pinned-fallback-mode question.
- **Depends on:** User Decision (V-005)

## Fix Progress

- Step 1: [APPLIED] 2026-06-19 — REQ-PORT-02 byte-identical golden-output equivalence bar (+ §8 bullet); REQ-REL-01 rewritten as zero-diff re-run invariant; REQ-USE-01 given minimal-site bound (zero files for declined components). (V-001, V-004)
- Step 2: [APPLIED] 2026-06-19 — Added REQ-PORT-03: monorepo targets register docs package in workspace manifest + emit root passthrough scripts, citing canon.md. (V-003)
- Step 3: [APPLIED] 2026-06-19 — Added REQ-VERIFY-04: non-transactional emission, partial state flagged, recoverable via re-run per user decision (V-002).
- Step 4: [APPLIED] 2026-06-19 — REQ-RERUN-01 now states re-run preserves existing version pins; OQ-1 left open per user decision (V-005).
