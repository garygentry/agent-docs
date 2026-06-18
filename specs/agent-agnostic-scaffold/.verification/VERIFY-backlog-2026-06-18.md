# Verification Report: agent-agnostic-scaffold — backlog

- **Date:** 2026-06-18
- **Mode:** backlog (forge-4-backlog complete; forge-verify-backlog pending)
- **Method:** 4 parallel `forge-verifier` instances (item scoping & AC, dependency/ordering, spec coverage & traceability, schema/enum correctness) + `rauf backlog validate`.
- **Artifacts reviewed:** backlog.json (24 items), PRD.md, tech-spec.md, specs 00–08, TRACEABILITY.md.

## Deterministic checks

- **`rauf backlog validate . --backlog specs/agent-agnostic-scaffold --specs-dir specs/agent-agnostic-scaffold`:** `valid=true`, 0 findings (exit 0). Schema, enums, IDs, statuses, specReference existence all pass.

## Summary

- **Total findings:** 5
- **Errors:** 0
- **Gaps:** 3 (V-001, V-002, V-003)
- **Inconsistencies:** 0
- **Improvements:** 2 (V-004, V-005)

The backlog is high quality: DAG is acyclic (24/24 topologically sort), no phantom IDs, foundation-before-feature ordering holds, items are right-sized (max description 195 words, ≤4 source files per impl item), acceptance criteria are concrete and each ends with a runnable verify command, and the schema/enum dimension is fully clean. The two dependency gaps are real missing import edges that could let a parallel loop schedule an item before a module it imports exists.

---

## Findings

### V-001: Item 016 (drift guard) imports `applyOverrides`/`loadOverrides` from item 014 but omits 014 from `dependsOn`
- **Severity:** gap
- **Location:** backlog.json item `016`, `dependsOn` (currently `["013","015"]`)
- **Issue:** Item 016's own description says it re-emits "in memory (emit 013 + applyOverrides 014)", and the authoritative spec 06-validation-and-drift-guard.md §2 (lines 146–160) shows `src/driftguard.ts` importing `{ applyOverrides, loadOverrides } from "./overrides.js"` (item 014's module) and calling them in `driftCheck`. This is a hard compile/runtime import edge, but 014 is absent from 016's `dependsOn` and there is no transitive path from 016 to 014 (016→013, 016→015→013/004 — none reach 014). A parallel loop runner could schedule 016 before 014 completes, and 016 would fail to import `applyOverrides`/`loadOverrides`. (The existing 015 edge is independently justified — 016 also imports the staging-dir helper from `./publish.js`.)
- **Suggested fix:** Change item 016 `dependsOn` to `["013","014","015"]`.
- **References:** backlog.json item 016 description; 06-validation-and-drift-guard.md §2 lines 146–160; item 014
- **Checklist:** CHECK-B (dependency technically justified), CHECK-B (every real dependency captured)

### V-002: Item 020 (CLI) imports/re-exports `loadManifest` from item 003 but omits 003 from `dependsOn` — leaving 003 an orphan
- **Severity:** gap
- **Location:** backlog.json item `020`, `dependsOn` (currently `["005","013","014","015","016","017","019"]`)
- **Issue:** Item 020 wires the pipeline beginning "`build`: loadManifest -> resolveConfig -> emit …" and updates the barrel to "re-export loadManifest (./manifest.js)". 01-architecture-layout.md §5 line 198 confirms `export { loadManifest } from "./manifest.js"`. `loadManifest` is owned by item 003, yet 003 appears in **no** item's `dependsOn` (depended on by nothing in the whole graph) and there is no transitive path from 020 to 003 (003's only ancestor is 002; nothing downstream of 003 feeds 020). Under parallel scheduling 020 could run before 003 exists. Secondary effect: because 003 blocks nothing, the loop could defer it indefinitely despite it being a build-blocking prerequisite.
- **Suggested fix:** Add `"003"` to item 020's `dependsOn` → `["003","005","013","014","015","016","017","019"]`. (Item 020 also calls `resolveConfig` from 004 directly, but 004 is already transitively satisfied via 020→015→004; adding 004 explicitly is optional.)
- **References:** backlog.json item 020 description; 01-architecture-layout.md §5 line 198; item 003
- **Checklist:** CHECK-B (dependency technically justified), CHECK-B (every real dependency captured), CHECK-B (foundation-before-feature ordering)

### V-003: REQ-STRUCT-04 authoring-conventions README has no covering backlog item
- **Severity:** gap
- **Location:** backlog.json (all 24 items); 01-architecture-layout.md §2.3; PRD.md REQ-STRUCT-04; TRACEABILITY.md row REQ-STRUCT-04 → 01
- **Issue:** REQ-STRUCT-04 (P1) requires authoring conventions to be **documented** "such that a new contributor can add a tool without reading the emitter source," and 01 §2.3 explicitly states the flow "is documented in the repo README (generated/maintained alongside, not part of the emitter source)." No backlog item produces this README — the word "README" appears in zero items. Item 001 creates the dir skeleton/config but no README; item 021 authors the sample tool but no authoring docs. Every other REQ-STRUCT requirement is satisfied structurally (01/02/03 by items 001/021), but the documentation obligation is orphaned.
- **Suggested fix:** Prefer folding into item 021 (co-locates the documented flow with the worked docs-helper example): append to its `description` "Author a repo README documenting authoring conventions per 01 §2.3 (where a tool lives, naming, how to add one, how to run `bun run build`), using docs-helper as the worked example"; add acceptance criterion "A repo README documents where a tool lives, how it is named, how to add one, and how to run a build (REQ-STRUCT-04, 01 §2.3)"; add `specs/agent-agnostic-scaffold/01-architecture-layout.md` to its `specReferences`. Alternative: a discrete doc item depending on 020.
- **References:** PRD.md REQ-STRUCT-04; 01-architecture-layout.md §2.3; SC-01
- **Checklist:** CHECK-B (spec-section coverage), CHECK-B (PRD-requirement-needing-artifact coverage), CHECK-B (no orphaned spec'd deliverable)

### V-004: Item 001 acceptance criteria do not assert the `gate` script content
- **Severity:** improvement
- **Location:** backlog.json item `001`, `acceptanceCriteria`
- **Issue:** The description specifies an exact `gate` script (the CON-05 CI bar: `compile && schema:check && typecheck && lint && format:check && test && build:check`), but the AC only generically asserts "package.json exists with the exact deps, devDeps, and scripts from 01 §3." The `gate` script is load-bearing — it defines the CI bar every later item's verify implicitly relies on — yet no AC names it, so a fresh agent could satisfy the criteria with a malformed/missing `gate` and still pass.
- **Suggested fix:** Add an acceptance criterion to item 001: "The `gate` script chains compile, schema:check, typecheck, lint, format:check, test, and build:check in that order (CON-05)."
- **References:** 01-architecture-layout.md §3; CON-05; item 001 `notes`
- **Checklist:** CHECK-B13, CHECK-B14

### V-005: Item 008 bundles "transform foundation + Claude target" (two deliverables on the critical path)
- **Severity:** improvement
- **Location:** backlog.json item `008`, `description`/`title`
- **Issue:** Item 008 combines the transform *foundation* (`_shared.ts`, the `TargetTransform` interface, the registry) with the first concrete target (`claude.ts` + test) — four files, two conceptual deliverables. It is within word/file limits and the two are cohesive (Claude is the trivial pass-through that validates the interface), so this is not a hard violation. But it is the one item with a mild "and then also…" smell, and since 009–012 all `dependsOn: ["008"]`, trouble in the Claude-target portion blocks all four other targets. `estimatedIterations` is 1, which is arguably light for the most-depended-on item.
- **Suggested fix:** Optional, user decision. Either accept as-is (Claude is the reference implementation that proves the interface — recommended, splitting is likely churn), or split into 008a "transform foundation (_shared + interface + registry)" and 008b "Claude target", repointing 009–012 to depend on 008a. If kept as-is, consider raising `estimatedIterations` to 2.
- **References:** author-backlog rules ("If you find yourself writing 'and then also…'"); spec 04 §3/§4/§6
- **Checklist:** CHECK-B25, CHECK-B11

---

## Fix Execution Plan

### User decisions required before applying — RESOLVED 2026-06-18
- **V-003:** [RESOLVED] Fold README into item 021 — extend its description + AC + specReference; no new item.
- **V-005:** [RESOLVED] Keep item 008 as-is (no split); raise `estimatedIterations` from 1 to 2.

### Step 1 — Add the two missing dependency edges (no user decision)
- **Files:** specs/agent-agnostic-scaffold/backlog.json
- **Addresses:** V-001, V-002
- **Action:** Item 016 `dependsOn` → `["013","014","015"]`. Item 020 `dependsOn` → `["003","005","013","014","015","016","017","019"]`. Both additions keep the graph acyclic (verified).
- **Depends on:** none

### Step 2 — Strengthen item 001 acceptance criteria
- **Files:** specs/agent-agnostic-scaffold/backlog.json
- **Addresses:** V-004
- **Action:** Append the gate-script criterion from V-004 to item 001 `acceptanceCriteria`.
- **Depends on:** none

### Step 3 — Cover REQ-STRUCT-04 README (per V-003 decision)
- **Files:** specs/agent-agnostic-scaffold/backlog.json
- **Addresses:** V-003
- **Action:** Per the user's choice, either extend item 021 (description + AC + specReference per V-003) or insert a new doc item depending on 020. Re-run `rauf backlog validate` after.
- **Depends on:** V-003 decision

### Step 4 (conditional) — Split item 008 (only if user opts in)
- **Files:** specs/agent-agnostic-scaffold/backlog.json
- **Addresses:** V-005
- **Action:** Only if chosen — split 008 into foundation + Claude target and repoint 009–012 `dependsOn`; renumber consistently and re-validate.
- **Depends on:** V-005 decision

---

*Generated by 4 parallel forge-verifier instances + `rauf backlog validate`. Findings renumbered uniquely across the merged set; no cross-instance duplicates. Schema/enum dimension returned zero findings.*

## Fix Progress

- Step 1: [APPLIED] 2026-06-18 — item 016 dependsOn → ["013","014","015"] (V-001); item 020 dependsOn → ["003","005","013","014","015","016","017","019"] (V-002). DAG re-validated acyclic.
- Step 2: [APPLIED] 2026-06-18 — item 001 gained the gate-script acceptance criterion (V-004).
- Step 3: [APPLIED] 2026-06-18 — item 021 extended to author the REQ-STRUCT-04 README (description + AC + specReference 01-architecture-layout.md), per resolved decision to fold into 021 (V-003).
- Step 4: [APPLIED] 2026-06-18 — item 008 kept as-is, estimatedIterations 1→2 per resolved decision (V-005).

All 5 findings addressed. `rauf backlog validate` re-run after edits: exit 0, no findings.
