# Verification Findings — doc-site-plugin (backlog)

- **Date:** 2026-06-19
- **Mode:** backlog
- **Pipeline stage:** forge-4-backlog complete; forge-verify-backlog pending
- **Artifacts reviewed:** specs/doc-site-plugin/backlog.json (12 items); PRD.md, tech-spec.md, 00–10 specs, TRACEABILITY.md; package.json (gate chain); .pipeline-state.json
- **Method:** 4 parallel forge-verifier instances (dimensions: item scoping & AC; dependency/ordering; spec coverage & traceability; schema/enum), plus the rauf loop-runner validator.
- **Loop-runner validation:** `rauf backlog validate . --backlog specs/doc-site-plugin --specs-dir specs --json` → exit 0, `{ "valid": true, "findings": [] }`.

## Summary

- **Total findings: 5** — 0 gap, 1 inconsistency, 4 improvement, 0 error.
- **Spec coverage & traceability:** clean — every deliverable in 01 §1's directory tree has exactly one owning item; no orphan items; all `specReferences` resolve and are correct; key spec mechanics (REQ-PORT-02, REQ-USE-01 decline-all, REQ-CORE-02, REQ-DIAG-02/03, REQ-SEC-02, REQ-VERIFY-01, the 10 §4-6 tests, static-netlify coverage) are present in acceptance criteria.
- **Schema/enum:** clean — valid against the rauf schema; correct `type`/`status` enums; `dependsOn` used; valid `model` aliases; project-root-relative `specReferences`.
- The findings are quality refinements to two backlog items' `agentDelegation`/scoping and three dependency-edge rationales. None block running the loop; none indicate a missing deliverable. Highest-value fix is **V-001** (a real parallel-write conflict inside item 007's delegation).

---

## Findings

### V-001 — Item 007 `agentDelegation` breaks its own disjoint-files invariant
- **Severity:** inconsistency
- **Location:** backlog.json → item 007 → `agentDelegation.subtasks[3]` and `agentDelegation.strategy` (and the mirrored clause in item 007 `description`)
- **What's wrong:** The strategy says the 4 sub-agents "write disjoint files" and run in parallel (`recommendedConcurrency: 4`). Subtasks 1-3 each author one deploy template **plus its own reference doc** (`deploy-github-pages.md`, `deploy-vercel.md`, `deploy-static-netlify.md`). Subtask 4 (monorepo) has no reference doc of its own and is told to "document the additive-merge/RERUN_SKIP semantics **in the deploy reference docs** per 06 §7" — i.e. write into the three files owned by subtasks 1-3. Four agents running concurrently would race on `deploy-*.md`, contradicting the disjoint-files claim and the self-containment requirement for delegated subtasks.
- **Suggested fix (recommended option a):** Give monorepo its own doc. Change subtask 4 to also author `references/monorepo.md` and relocate the additive-merge / RERUN_SKIP / `dev:docs`/`build:docs` documentation there; remove "in the deploy reference docs" from subtask 4 **and** from the item-level `description`; add `references/monorepo.md` to acceptanceCriteria (the deploy-docs criterion). Keep `recommendedConcurrency: 4` (still 4 disjoint subtasks) and update `strategy` so "write disjoint files" stays true. *(Alternative b: move the monorepo-merge documentation duty into subtasks 1-3, each covering its own target, and reduce subtask 4 to the two template fragments only.)*
- **References:** backlog item 007; spec 06-deploy-and-monorepo.md §7; 01-architecture-layout.md §1 (note: §1's tree does not list `references/monorepo.md`, so option (a) adds a new doc — acceptable, or use option (b) to stay within the listed file set).
- **Checklist:** CHECK-B25 (agentDelegation well-formedness), CHECK-B12 (self-contained subtasks)

### V-002 — Item 004 authors 10 files with no `agentDelegation` (largest plain item)
- **Severity:** improvement
- **Location:** backlog.json → item 004 ("core/ template group + core.md + manifest-schema.md")
- **What's wrong:** Item 004 creates 8 template assets under `templates/core/` plus 2 reference docs = 10 new files, and `core.md` must additionally document the non-trivial `buildSidebar` algorithm (03 §7) and the manifest-write procedure. That equals item 007's file count, but 007 was given an `agentDelegation` block to stay within one iteration while 004 has none. Description length (≈183 words) is fine; the concern is breadth of distinct artifacts/emit surface in a single iteration.
- **Suggested fix:** Either (a) add an `agentDelegation` block to item 004 mirroring 007 — e.g. subtask A: the 6 managed plumbing templates (astro.config / package.json / tsconfig / content.config / custom.css / favicon); subtask B: the 2 authored MDX pages (index.mdx / starter-page.mdx); subtask C: `core.md` + `manifest-schema.md` — with `recommendedConcurrency` matching and a shared `bun run gate`; or (b) split 004 into 004a (core templates) + 004b (core.md / manifest-schema.md) and re-point the `dependsOn` of items 005-009 accordingly. **Option (a) is recommended** (no dependency-graph churn).
- **References:** backlog items 004 vs 007 (delegation precedent); spec 03-core-site-and-manifest.md §3, §7
- **Checklist:** CHECK-B11 (single-iteration sizing), CHECK-B25

### V-003 — Item 011 → 010 dependency is over-constrained, and its `notes` rationale is factually wrong
- **Severity:** improvement (contains an embedded factual error in the `notes` text)
- **Location:** backlog.json → item 011 `dependsOn: ["010"]` and item 011 `notes`
- **What's wrong:** Item 011's tests (spec 10 §4) read ONLY from `skills/doc-site-plugin/` (templates + SKILL.md) — never from `adapters/` or `SAMPLE_RELPATHS`. The assets it validates all exist after items 002-009; it consumes nothing item 010 produces, so there is no real artifact dependency on 010. Separately, item 011's `notes` justify the edge by claiming the gate "runs build:check before/with test" — this is **incorrect**: the gate (`package.json` `gate`) runs `… && test && build:check && …`, i.e. `test` runs *before* `build:check`. Because the skill stays unregistered until item 010 (by item 001's design), `build:check` would not expect it pre-010 and the gate stays green either way, so 011 could depend on 009 instead.
- **Suggested fix:** Either (a) change item 011 `dependsOn` to `["009"]` and correct the notes to: "011 validates the authored template/SKILL assets under skills/doc-site-plugin/, all present after item 009; the tests read skills/ directly, not adapters/." Or (b) keep `["010"]` as an intentional post-integration ordering choice but **delete the false gate-ordering sentence** and relabel it a sequencing preference. **Option (a) recommended** (per the "no dependencies for mere logical-ordering preference" rule). Either way, the false gate-ordering claim must be removed.
- **References:** 10-testing-strategy.md §4; package.json (`gate` chain ordering); backlog item 001 notes (registration deferred to 010)
- **Checklist:** CHECK-B (dependency-has-real-reason), CHECK-B (over-constraint), CHECK-B (rationale accuracy)

### V-004 — Within-tier priority inversion: p2 item 006 ordered before p1 items 007/008
- **Severity:** improvement
- **Location:** backlog.json → items 005-008 (one dependency tier; all depend on exactly [001, 004])
- **What's wrong:** Within a dependency tier, items should be ordered p1 before p2. This tier's priorities are 005=p1, 006=**p2** (diagrams), 007=p1, 008=p1 — the p2 item precedes two p1 items. Moreover items 009 and 010 **hard-depend on 006**, and the pipeline notes mark "MVP = EVERYTHING in canon at P0 … (incl. diagrams)", so 006's p2 label understates its actual criticality.
- **Suggested fix (recommended, low-churn):** Change item 006 `"priority": 2` → `"priority": 1` to match its P0/hard-prerequisite status; this makes the 005-008 tier uniformly p1 and satisfies within-tier ordering with no renumbering. *(Alternative: if diagrams is genuinely lower priority, renumber the tier so p1 items precede 006 and update the `dependsOn` references to 006/007/008 in items 009 and 010.)*
- **References:** .pipeline-state.json notes ("all 7 areas at P0"); backlog items 009/010 `dependsOn` (006 is a hard prerequisite)
- **Checklist:** CHECK-B (within-tier priority ordering)

### V-005 — Item 012 → 011 dependency is over-constrained (ordering, not artifact)
- **Severity:** improvement
- **Location:** backlog.json → item 012 `dependsOn: ["011"]` and notes
- **What's wrong:** Item 012 (scaffold goldens) uses its own `resolveTree` helper, its own answer-set fixtures, and its own `__scaffold_golden__` trees; it reads `references/templates/**` (present after 002-009) and consumes nothing item 011 produces (ajv devDep, `doc-site-templates.test.ts`, manifest fixtures). The notes justify the edge as "sequenced after 011 so the gate stays green" — an ordering preference, not a technical dependency. 011 and 012 are independently parallelizable (disjoint files/fixtures); chaining them forecloses that.
- **Suggested fix:** Align with the V-003 decision. If relaxing, re-point 012 to the last real producer of its inputs (after the V-003 fix, `["009"]`) and relabel the rationale as an ordering preference noting 011/012 are parallelizable. If keeping `["011"]`, relabel the notes as an intentional sequencing preference rather than implying a technical dependency.
- **References:** 10-testing-strategy.md §5 (012) vs §4 (011); package.json (both under one `test` stage)
- **Checklist:** CHECK-B (over-constraint), CHECK-B (parallelizable-items-independent)

---

## Confirmed-correct (no findings)

- `004 → 002`: real — core copies `docs.manifest.schema.json` (authored by 002) into the target and documents it in core.md/manifest-schema.md (03 §6).
- `005/006/007/008 → [001, 004]`: real — each component's reference doc cross-references core's `package.json` insertion point / `astro.config.mjs` env consumer (04 §6).
- `009 → [001,004,005,006,007,008]`: real — rerun.md and finalized SKILL.md cross-reference every component's managed files and reference docs.
- `010 → [002…009]`: complete — every item that writes under `skills/doc-site-plugin/` is a dependency (003's detect.md/interview.md included, since 010 emits all `references/**` verbatim). Not under-constrained.
- DAG is valid: no cycles, no phantom IDs, sequential zero-padded IDs, foundation-first.

---

## Fix Execution Plan

These fixes edit only `specs/doc-site-plugin/backlog.json` (V-001 also touches its `agentDelegation`/description text). All are independent; apply in any order. Re-run `rauf backlog validate . --backlog specs/doc-site-plugin --specs-dir specs --json` after editing (must stay exit 0).

### User decisions required
1. **V-002:** add `agentDelegation` to item 004 (option a, recommended) vs split into 004a/004b (option b).
2. **V-003 / V-005:** relax the 011/012 test edges to real producers (`["009"]`, recommended) vs keep post-integration ordering but relabel rationales. Apply the same choice to both for consistency.
3. **V-004:** reclassify item 006 to priority 1 (option a, recommended) vs renumber the 005-008 tier (option b).
4. **V-001:** give monorepo its own `references/monorepo.md` (option a) vs fold monorepo docs into subtasks 1-3 (option b). Note option (a) adds a file not listed in 01 §1's tree.

### Step 1 — Fix item 007 delegation write-conflict (V-001)
Apply the chosen V-001 option so the four subtasks write disjoint files. If option (a): add `references/monorepo.md` to subtask 4 and to item 007's acceptanceCriteria; remove "in the deploy reference docs" from subtask 4 and the item `description`; update `agentDelegation.strategy`. Keep `recommendedConcurrency: 4`.

### Step 2 — Right-size item 004 (V-002)
Apply the chosen V-002 option: add an `agentDelegation` block (disjoint subtasks: plumbing templates / authored MDX / reference docs, shared `bun run gate`), or split into 004a/004b and update items 005-009 `dependsOn`.

### Step 3 — Correct item 006 priority / tier ordering (V-004)
Set item 006 `"priority": 1` (recommended), or renumber the tier and update `dependsOn` in items 009/010.

### Step 4 — Correct test-chain dependencies & rationales (V-003, V-005)
Apply the chosen edge treatment to items 011 and 012 consistently. In all cases, **delete the false "gate runs build:check before/with test" sentence** from item 011's notes (this is the embedded factual error in V-003).

### Step 5 — Re-validate
Run `rauf backlog validate . --backlog specs/doc-site-plugin --specs-dir specs --json`; confirm exit 0. Optionally re-run `/feature-forge:forge-verify doc-site-plugin` to confirm findings cleared.
