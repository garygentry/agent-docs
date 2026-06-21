# Verification Findings — diagram-generator (tech mode)

- **Feature:** diagram-generator
- **Mode:** tech
- **Date:** 2026-06-18
- **Artifacts verified:** `tech-spec.md` (against `PRD.md` v2, `.reference/research.md`, `.pipeline-state.json`, consumer `../doc-site-plugin/PRD.md`, and live source: `src/schema-gen.ts`, `src/model.ts`, `src/publish.ts`, `src/discover.ts`, `src/targets/_shared.ts`, `src/test/golden.*`, `package.json`)
- **Checks executed:** 17 of 17 — 12 pass, 5 fail
- **Findings:** 7 (3 gap, 1 inconsistency, 1 improvement, 2 error)

## Summary

The architecture is sound and the major decisions trace cleanly to requirements.
Source verification **confirmed** the load-bearing integration claims: executable
mode is preserved (`publish.ts:118-119` `statSync … chmodSync`), the golden suite
uses three-way set equality so new relpaths must be registered, `collectOwnedTree`/
`skillVerbatimRecords` ship skill `scripts/` verbatim, and the `gate` wiring is as
described.

Findings fall in three buckets: (1) two **factual errors** about reuse that would
mislead the implementer (V-001 schema-gen is not parameterized; V-002 `config` is
not a ToolEntry field), (2) **P0 requirement-coverage gaps** in the output contract
(REQ-OUT-02 viewBox, REQ-OUT-04 fonts) plus an undocumented home for REQ-IN-03, and
(3) two **risk/contract** items needing decisions: SVG byte-determinism feasibility
(V-003) and the consumer-facing output-path naming (V-007).

Two findings require user decisions before fixing: **V-005 (font strategy)** and
**V-007 (output-path naming in the frozen contract)**.

---

## Findings

### V-001 — "Reuse the existing schema-gen pattern" understates new work (factual)
- **Severity:** error
- **Location:** `tech-spec.md` §3.2 and §6
- **What's wrong:** `src/schema-gen.ts` is hardwired to the `Manifest` Zod object
  with a single `SCHEMA_OUTPUT_PATH` constant and one `import.meta.main --check`
  CLI. Only the `zodToJsonSchema` import is reusable. Emitting a second schema for
  `DiagramSpec` requires NEW code (a parameterized refactor over (zodSchema,
  outputPath), or a sibling generator) plus new `schema:gen`/`schema:check` scripts
  wired into `gate`. The spec presents this as drop-in reuse.
- **Suggested fix:** Reword §3.2/§6 to state a new generator entrypoint (e.g.
  `src/diagram/schema-gen.ts`, or a parameterized refactor of `src/schema-gen.ts`)
  and new diagram-schema `schema:gen`/`schema:check` scripts are required and wired
  into `gate` — added code, not reuse of the existing CLI.
- **References:** `src/schema-gen.ts` (lines 21, 35, 52, 58-90), `package.json` scripts
- **Checklist:** CHECK-T05, T08, T14, T16

### V-002 — §6 conflates `config` with `ToolEntry` (factual)
- **Severity:** error
- **Location:** `tech-spec.md` §6, first "Depends on" bullet — "(`config` block unchanged; verified shape from `src/model.ts`.)"
- **What's wrong:** `ToolEntry` is `{ name, type, source, description?, targets? }`
  (`src/model.ts:37-48`). `config` is a **top-level Manifest field**
  (`EmitterConfig`, model.ts:83), not part of a ToolEntry. The proposed entry
  itself is valid; only the parenthetical is wrong.
- **Suggested fix:** Reword to "(the Manifest's top-level `config` block is
  unchanged; only `tools[]` gains one entry)."
- **References:** `src/model.ts` lines 37-50, 75-88
- **Checklist:** CHECK-T05, T06, T08

### V-003 — SVG byte-determinism (REQ-REPRO-01) asserted without surfacing the Graphviz-WASM risk
- **Severity:** gap
- **Location:** `tech-spec.md` §8 (determinism test) and §3.1
- **What's wrong:** The spec asserts byte-identical SVG as a hard test but never
  acknowledges that `@viz-js/viz` output may not be byte-stable (float layout,
  coordinate rounding, generated-ID order). PNG variance IS handled (pinned +
  smoke-only), but the SVG determinism claim — the load-bearing one for
  REQ-REPRO-01 (P1) — gets no equivalent caution, and no OTQ owns it.
- **Suggested fix:** Add to §3.1/§8 that byte-identical SVG requires pinning
  `@viz-js/viz` and a **canonicalization pass** in `svg-postprocess.ts` (stable
  element/attribute ordering, fixed coordinate precision, deterministic IDs).
  Either commit to it or add **OTQ-6** deferring the determinism strategy to
  forge-3-specs, parallel to the resvg/PNG treatment.
- **References:** research.md §E + Caveats; PRD REQ-REPRO-01; tech-spec.md §3.4 (svg-postprocess.ts)
- **Checklist:** CHECK-T03, T16, T17

### V-004 — REQ-OUT-02 (viewBox + width/height + absolute coords) has no technical home
- **Severity:** gap
- **Location:** `tech-spec.md` — absent; PRD REQ-OUT-02 (P0)
- **What's wrong:** Every other P0 OUT/A11Y/REL property appears in the §3.5
  output-validation list, but REQ-OUT-02 does not. The Graphviz path likely emits
  viewBox naturally, but `sequence-svg.ts` (hand-built) is exactly where this must
  be enforced explicitly.
- **Suggested fix:** Add `viewBox` + width/height presence (and a coordinate
  well-formedness sanity check) to the §3.5 step-2 assertions and the §8 property
  list, citing REQ-OUT-02.
- **References:** PRD REQ-OUT-02; tech-spec.md §3.5, §8; research.md (svg-precision rules)
- **Checklist:** CHECK-T01, T03, T12

### V-005 — Font portability (REQ-OUT-04 / REQ-PORT-01) has no decision
- **Severity:** gap
- **Location:** `tech-spec.md` — absent; PRD REQ-OUT-04 (P0), REQ-PORT-01 (P0)
- **What's wrong:** The spec covers no-CDN/no-network but takes no position on the
  **font strategy** — system-stack vs embedded/subsetted data-URI. A system
  font-family reference passes the §8 "no external URL" check yet can render
  differently across viewers, weakening tier-2 "opens identically everywhere."
- **Suggested fix:** Decide fonts — commit to a documented system-font stack (and
  note the cross-viewer tolerance that implies) OR subset/embed a bundled font as a
  base64 data-URI. Reflect in §3 and add a font-strategy assertion to §8 beyond
  "no external URL."
- **References:** PRD REQ-OUT-04, REQ-PORT-01; research.md Caveats (font embedding), §126-130 (Cocoon CDN-font anti-pattern)
- **Checklist:** CHECK-T01, T03, T16
- **⚠ Needs user decision:** see Fix Plan Step A.

### V-006 — REQ-IN-03 ("MUST NOT invent content") names no enforcement mechanism
- **Severity:** improvement
- **Location:** `tech-spec.md` §3.2 (NL mode)
- **What's wrong:** REQ-IN-03 (P0) is a behavioral constraint that, for the NL
  path, lives in SKILL.md prompt discipline. §3.2 never names where it's enforced,
  risking silent drop in forge-3-specs. (Improvement, not gap — it's a prompt
  concern, not code.)
- **Suggested fix:** Add a clause to §3.2 noting REQ-IN-03 is enforced via SKILL.md
  authoring guidance (depict only what was described) and is not machine-validatable
  in v1.
- **References:** PRD REQ-IN-03; tech-spec.md §1, §3.2
- **Checklist:** CHECK-T01, T03

### V-007 — Consumer-facing output-path naming under-specified in the frozen contract
- **Severity:** inconsistency
- **Location:** `tech-spec.md` §5 contract dimension 2 ("Output") vs `../doc-site-plugin/PRD.md` REQ-DIAG-03 / OQ-4(b)
- **What's wrong:** doc-site-plugin depends on **caller-specified output paths**.
  §5 lets the caller specify the *directory* but derives the *filename* from a
  title slug whose algorithm (casing, spaces, unicode, collisions) is unspecified —
  so the consumer can't predict paths without knowing the slug rules, and those
  rules would be part of the versioned contract surface.
- **Suggested fix:** Either (a) specify the exact slugification algorithm in §5 and
  fold it into `CONTRACT_VERSION`, or (b) add an explicit `--out-file`/`--out-name`
  option so callers fully specify output paths. Cross-check doc-site-plugin
  REQ-DIAG-03 before freezing.
- **References:** tech-spec.md §5; doc-site-plugin REQ-DIAG-02/03, OQ-4, CON-05
- **Checklist:** CHECK-T01, T06, T07, T16
- **⚠ Needs user decision:** see Fix Plan Step A.

---

## Confirmed-correct (high-scrutiny passes)
- **publish.ts:118-119 mode preservation — CONFIRMED** (`statSync(...).mode & 0o777` → `chmodSync`).
- **Golden three-way set equality — CONFIRMED** (`golden.test.ts:76-78`); new relpaths must be registered in `SAMPLE_RELPATHS` (`golden.shared.ts:34`). **Note for forge-3-specs:** register for ALL FIVE targets with their per-target transforms (gemini `skills/<name>/<name>.md`, copilot `instructions/<name>.instructions.md`, cursor `rules/<name>.mdc`) — §2/§6's "SKILL.md, references, scripts" phrasing is claude-shaped and must not mislead.
- **`collectOwnedTree` / `skillVerbatimRecords` verbatim ship — CONFIRMED** (scripts get mode 0o755).
- **`gate` wiring — CONFIRMED**; adding `build:diagram:check` + diagram schema check is consistent.
- **OTQ-1..5 deferral — appropriate**, not flagged (except the determinism gap V-003, which no OTQ owns).

---

## Fix Execution Plan

### Step A — User decisions (RESOLVED 2026-06-18)
1. **Fonts (V-005):** RESOLVED → **embedded/subsetted data-URI font**. One bundled
   font, subset, embedded as base64 in each SVG for true opens-identically-everywhere.
2. **Output-path naming (V-007):** RESOLVED → **explicit `--out-file`/`--out-name`
   flag**, with `--out-dir` + derived slug retained as a convenience default.
   Consumers get deterministic paths without knowing slug rules.

### Step 1 — Correct integration-accuracy errors (V-001, V-002)
Edit §3.2/§6: state the diagram schema needs a NEW generator + new schema scripts
(not reuse of the hardwired `schema-gen.ts` CLI); fix the `config` parenthetical
(`config` is a top-level Manifest field, not a ToolEntry field). No dependencies.

### Step 2 — Close P0 output-contract gaps (V-004, V-005)
Add `viewBox`+width/height + coordinate well-formedness to §3.5 step-2 and §8
(REQ-OUT-02). Add the font-strategy decision (Step A) for REQ-OUT-04 and a matching
§8 assertion beyond "no external URL." Depends on Step A (fonts).

### Step 3 — Surface SVG determinism risk (V-003)
Add the pinning + canonicalization note to §3.1/§8, or add OTQ-6 deferring the
determinism strategy. No dependencies.

### Step 4 — Tighten the §5 output-path contract (V-007)
Per Step A decision, specify the slug algorithm (and fold into `CONTRACT_VERSION`)
or add an explicit output-filename flag; ensure doc-site-plugin can compute paths
deterministically. Do last so it references corrected text. Depends on Step A.

### Step 5 — Give REQ-IN-03 a documented home (V-006)
Add a §3.2 clause: REQ-IN-03 enforced via SKILL.md authoring guidance, not
machine-validatable in v1. No dependencies.
