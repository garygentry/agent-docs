# Verification Findings — doc-site-plugin (tech mode)

> Feature: `doc-site-plugin` · Mode: tech · Date: 2026-06-19
> Artifacts verified: PRD.md (forge-1-prd v2), tech-spec.md (forge-2-tech v1),
> .reference/canon.md · Verifier: forge-verifier subagent (single dispatch)
> Checks executed: 15 of ~15 — 11 pass, 4 fail, 0 n/a · Findings: 5
> (1 error, 1 inconsistency, 1 gap, 2 improvements)

## Summary

The tech spec is strong: the diagram-generator contract (§5.2/§3.6) was verified
byte-accurate against `src/diagram/schema.ts` and
`specs/diagram-generator/05-cli-and-invocation.md` (CONTRACT_VERSION `1.0.0`, exit
codes `0/2/3/4/5/6/64`, flag set, output-path precedence, no `--theme both`,
`--format both` SVG-then-PNG ordering) — **no findings there**. The
`tools.manifest.json` `ToolEntry` shape and the additive-registration claim are
accurate. The five findings below are: one factual error (gate chain), one
inconsistency requiring a user decision (schema-gen vs "zero src changes"), one
coverage gap (detection/interview decision absent), and two precision
improvements (resolvable carry-forward; understated golden surface).

---

## Findings

### V-001 — Carry-forward "per-target owned-script path" is actually fully resolvable now
- **Severity:** improvement
- **Location:** tech-spec.md §6 (WARNING note) and §10 ("Remaining to confirm during forge-3-specs")
- **What's wrong:** The spec flags, as an unresolved carry-forward, the exact
  per-target path where the vendored `diagram-render.mjs` sibling lands
  (copilot/cursor vs claude/codex/gemini). It is **not** unresolved — it is fully
  determined by `skillRefDir(target, name)` in `src/targets/_shared.ts:203`:
  cursor → `rules/<name>`, copilot → `instructions/<name>`, all others →
  `skills/<name>`. Because both `doc-site-plugin` and `diagram-generator` are
  skills, they share the same per-target parent dir, so the **relative path from
  the doc-site skill's own dir to the sibling renderer is uniform across all five
  targets**: `../diagram-generator/scripts/diagram-render.mjs`. The agent reads
  the sibling at one relative path regardless of agent.
- **Suggested fix:** In §3.6 and §6, replace the WARNING/carry-forward with the
  resolved fact: the sibling renderer is always at
  `../diagram-generator/scripts/diagram-render.mjs` relative to the doc-site
  skill's bundle dir (per `skillRefDir` placing both skills under the same
  per-target root: `skills/` / `rules/` / `instructions/`). Remove the §10
  "Remaining to confirm" bullet (or restate it as resolved). `diagrams.md` can
  then specify a single relative sibling path, not per-agent branches.
- **References:** src/targets/_shared.ts:203 (`skillRefDir`), :226 (`skillVerbatimRecords`); tech-spec.md §3.6, §6, §10
- **Checklist:** CHECK-T11, CHECK-T08

### V-002 — Quoted `gate` chain omits `schema:check:diagram`
- **Severity:** error
- **Location:** tech-spec.md §6 (Integration Points, the `gate` script row)
- **What's wrong:** The spec quotes the gate chain as
  `compile → schema:check → typecheck → lint → format:check → test → build:check → build:diagram:check`.
  The real chain (`package.json`) is
  `compile → schema:check → schema:check:diagram → typecheck → lint → format:check → test → build:check → build:diagram:check`
  — it omits the `schema:check:diagram` stage. This matters because V-003's
  resolution may add a *third* schema-check stage to this same chain; quoting it
  wrong invites forge-3-specs to wire the gate incorrectly.
- **Suggested fix:** Correct the §6 gate-chain quote to include
  `schema:check:diagram` (between `schema:check` and `typecheck`). If V-003 is
  resolved toward a generated docs-manifest schema, also note the new
  `schema:check:doc-site` (or equivalent) stage that must be added to `gate`.
- **References:** package.json (`gate` script, line 25; `schema:check:diagram` line 19); tech-spec.md §6, §8
- **Checklist:** CHECK-T05, CHECK-T13

### V-003 — "Zero src/ changes" contradicts "author docs.manifest.schema.json via the existing schema-gen" — requires a decision
- **Severity:** inconsistency
- **Location:** tech-spec.md §1 / §2 / §3.1 (repeated "no `src/` emitter changes / purely additive") vs §2, §3.4, §6, §8 ("authored here … via the existing `schema-gen` pattern")
- **What's wrong:** The spec asserts the feature needs zero `src/` changes, but
  also says `docs.manifest.schema.json` is generated "via the existing schema-gen
  pattern." `src/schema-gen.ts` is **hardwired to the `Manifest` Zod source**
  (`SCHEMA_OUTPUT_PATH = "schemas/tools.manifest.schema.json"`, imports
  `Manifest` from `./model.js`) — it cannot emit a second, unrelated schema. The
  precedent confirms this: the diagram feature needed its **own**
  `src/diagram/schema-gen.ts` for `diagram-input.schema.json`. So generating a
  docs-manifest schema "via schema-gen" necessarily means **new `src/` code**
  (a `src/doc-site/schema-gen.ts` + Zod model + a new `schema:check:doc-site`
  gate stage), which contradicts "purely additive, zero src changes." The two
  claims cannot both hold. **This needs a user decision** (see Fix Plan).
- **Suggested fix:** Resolve one of three ways and update §2/§3.1/§3.4/§8
  consistently: **(A)** add a small `src/doc-site/schema-gen.ts` + Zod model +
  `schema:check:doc-site` gate stage (mirrors the diagram precedent) — and revise
  the "zero src/ changes" claim to "no *emitter* changes; one additive
  schema-gen module like diagram-generator's"; **(B)** hand-author
  `docs.manifest.schema.json` as a **static asset** (no schema-gen, genuinely zero
  src changes) validated only by a vitest test that the schema parses + accepts
  fixtures; **(C)** drop the JSON Schema entirely and validate the manifest with a
  runtime check in `check-docs.mjs` only.
- **References:** src/schema-gen.ts (hardwired to `Manifest`, line 18/21); src/diagram/schema-gen.ts (separate per-feature schema-gen precedent); tech-spec.md §1, §2, §3.4, §8 (test #2)
- **Checklist:** CHECK-T03, CHECK-T13, CHECK-T02

### V-004 — In-repo byte-identity guarantee for the asset tree is understated
- **Severity:** improvement
- **Location:** tech-spec.md §8 (test #1 "Golden emission snapshots") and §2 (SAMPLE_RELPATHS note)
- **What's wrong:** §8 leans on adding `doc-site-plugin` to `SAMPLE_RELPATHS`
  (`src/test/golden.shared.ts`) for cross-agent byte-identity. But the golden
  snapshot set asserts only a **representative selection** of relpaths; the
  comprehensive byte-identity guarantee for the *entire* emitted asset tree
  (every template under `assets/templates/**` riding verbatim to every adapter)
  is enforced by `build:check` (re-emit + diff against the committed `adapters/`
  tree), not by the golden file-set. As written, §8 risks implying golden
  snapshots alone cover REQ-PORT-02 for the asset tree.
- **Suggested fix:** In §8 test #1, state that `build --check` is the
  authoritative full-tree byte-identity gate (re-emits all owned refs/assets and
  diffs the committed `adapters/`), and the golden `SAMPLE_RELPATHS` entries are a
  fast representative subset. Pick a few high-signal relpaths to pin in goldens
  (e.g. `SKILL.md`, one template, the vendored-renderer-adjacent path) and let
  `build:check` cover the rest.
- **References:** src/test/golden.shared.ts (SAMPLE_RELPATHS), src/test/golden.test.ts, src/driftguard.ts (`build --check`); tech-spec.md §2, §8
- **Checklist:** CHECK-T13, CHECK-T08

### V-005 — No §3 technical decision for the P0 detection + interview requirements
- **Severity:** gap
- **Location:** tech-spec.md §3 (no §3.x for detection/interview); PRD.md REQ-DETECT-01, REQ-DETECT-02, REQ-INT-01, REQ-INT-02
- **What's wrong:** Four P0 requirements govern detection and interview —
  REQ-DETECT-01 (detect monorepo/PM/runtime/docs/CI/branch/slug), REQ-DETECT-02
  (graceful degradation + flagged assumptions, hard-fail only when impossible),
  REQ-INT-01 (interview captures title/description/social/mode/page-mapping/deploy/
  brand/docs-location), REQ-INT-02 (every undetected param obtainable via
  interview with a default). The tech spec references `detect.md` / `interview.md`
  in the §2 layout and touches detection-ambiguity in §7, but **§3 Technical
  Decisions has no decision section** stating *how* detection is performed (what
  files/signals are read, the detection→default table) or *how* the interview is
  structured/derived. These P0 requirements have no traceable HOW.
- **Suggested fix:** Add a §3.x "Detection & interview" decision: enumerate the
  detection signals and their source files (e.g. `package.json`
  workspaces/`packageManager`, `pnpm-workspace.yaml`, `.bun-version`/`bun.lock`,
  `docs/*.md` presence, `.github/workflows/`, `git remote`/default branch), the
  detection→default fallback table (REQ-DETECT-02), and the interview parameter
  set with per-parameter defaults (REQ-INT-01/02). Cross-reference the
  `detect.md`/`interview.md` reference docs as the detailed home, but record the
  load-bearing decisions in §3 for traceability.
- **References:** PRD.md REQ-DETECT-01/02, REQ-INT-01/02; canon.md §1 "Detect & interview"; tech-spec.md §2, §3, §7
- **Checklist:** CHECK-T01, CHECK-T02, CHECK-T12

---

## Fix Execution Plan

### User Decisions Required (blocking)

- **V-003:** How is `docs.manifest.json` validated, given `src/schema-gen.ts` is
  hardwired to `Manifest` and cannot emit a second schema?
  - **(A)** New `src/doc-site/schema-gen.ts` + Zod model + `schema:check:doc-site`
    gate stage (mirrors diagram-generator precedent). Revise "zero src changes" to
    "no emitter changes; one additive schema-gen module."
  - **(B)** Hand-authored static `docs.manifest.schema.json` asset + a vitest
    validation test (genuinely zero src changes). *(Recommended — keeps the
    feature purely a skill+assets deliverable.)*
  - **(C)** Drop JSON Schema; validate the manifest at runtime inside
    `check-docs.mjs` only.

  V-002's gate-chain fix and V-003's resolution both touch the `gate` chain, so
  resolve V-003 before finalizing Step 1.

### User Decisions — Resolved (2026-06-19)

- **V-003 → option (B):** Hand-author `docs.manifest.schema.json` as a **static
  asset** under `assets/` (no schema-gen, no new `src/` module, no new gate
  stage), validated by a vitest test that the schema parses and accepts/rejects
  fixtures. The "zero `src/` changes / purely additive" claim therefore **holds**
  and stays as-is. Step 1 below must NOT add a `schema:check:doc-site` gate stage.
  Step 2 updates §2/§3.4/§8 to describe the static schema asset + test (not
  schema-gen).

### Execution Steps

**Step 1 — Correct the gate-chain quote (V-002).** File: tech-spec.md §6. Insert
`schema:check:diagram` between `schema:check` and `typecheck`. If V-003 resolves
to (A), also add the new `schema:check:doc-site` stage to the quoted chain and to
§8. No other dependencies. (CHECK-T05, T13)

**Step 2 — Resolve the schema-gen inconsistency (V-003).** Files: tech-spec.md
§1, §2, §3.4, §8. *After the V-003 decision*, make the "zero src/ changes" claim
and the schema mechanism consistent everywhere they appear. Touches §8 test #2.
(CHECK-T03, T13, T02)

**Step 3 — Resolve V-001 carry-forward in place.** Files: tech-spec.md §3.6, §6,
§10. Replace the WARNING/"remaining to confirm" with the resolved uniform sibling
path `../diagram-generator/scripts/diagram-render.mjs` (per `skillRefDir`). Pure
edit, no dependencies. (CHECK-T11, T08)

**Step 4 — Add the detection/interview decision (V-005).** File: tech-spec.md add
§3.x. Enumerate detection signals + source files, the detection→default table,
and the interview parameter/default set; cross-ref `detect.md`/`interview.md`.
Pure addition. (CHECK-T01, T02, T12)

**Step 5 — Clarify the in-repo byte-identity surface (V-004).** Files:
tech-spec.md §2, §8 (test #1). State `build --check` is the authoritative
full-tree gate; goldens pin a representative subset. Pure edit. (CHECK-T13, T08)

---

## Next Steps

Findings and fix plan above are self-contained. Recommended order: resolve the
V-003 decision, then run `/feature-forge:forge-fix doc-site-plugin` to apply all
five fixes.

## Fix Progress

- Step 1: [APPLIED] 2026-06-19 — V-002: corrected §6 gate-chain quote to include `schema:check:diagram`; noted no new gate stage is added (static schema asset).
- Step 2: [APPLIED] 2026-06-19 — V-003 (decision B): §3.4/§6/§8/§2/§9 now describe `docs.manifest.schema.json` as a hand-authored static asset validated by a vitest test, NOT schema-gen output; "zero src/ changes" claim preserved and made consistent.
- Step 3: [APPLIED] 2026-06-19 — V-001: §3.6/§6/§10 resolved the carry-forward — uniform sibling path `../diagram-generator/scripts/diagram-render.mjs` across all 5 targets (per `skillRefDir`); removed the §6 WARNING and §10 open item.
- Step 4: [APPLIED] 2026-06-19 — V-005: added §3.12 "Detection & interview" with the detection-signal→source→fallback table and interview parameter/default set (REQ-DETECT-01/02, REQ-INT-01/02, REQ-USE-02).
- Step 5: [APPLIED] 2026-06-19 — V-004: §8 test #1 now states `build --check` is the authoritative full-tree byte-identity gate and goldens pin a representative subset.
