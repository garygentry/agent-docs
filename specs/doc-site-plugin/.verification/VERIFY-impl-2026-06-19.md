# Verification Report: doc-site-plugin (impl)

Date: 2026-06-19
Pipeline Stage: forge-5-loop complete → forge-6-docs
Mode: impl (parallel 4-dimension fan-out)

Artifacts Reviewed:
- skills/doc-site-plugin/SKILL.md + references/*.md (12 docs) + references/docs.manifest.schema.json + references/templates/** (18 assets)
- tools.manifest.json (registration), src/test/golden.shared.ts (SAMPLE_RELPATHS)
- src/test/doc-site-templates.test.ts, doc-site-scaffold.test.ts, doc-site-scaffold.shared.ts, regenerate-scaffold-goldens.ts
- src/test/__fixtures__/doc-site/**, src/test/__scaffold_golden__/**, src/test/__golden__/<5 targets>/
- src/discover.ts, eslint.config.mjs
- specs/doc-site-plugin/{PRD.md, tech-spec.md, 00..10, TRACEABILITY.md}

Build/test gates (parent-gathered): `bun run build` = 0, `bun run build:check` (drift) = 0, `tsc --noEmit` = 0, `npx vitest run` = 467 passed / 1 skipped.

Checks Executed: 22 of ~20 across 4 dimensions — 20 pass, 0 fail, 2 N/A (eslint over md/templates).
- Dim 1 requirement-coverage (CHECK-I01–I07, I13–I15): 10/10 pass, 0 findings
- Dim 2 integration (CHECK-I08–I10 + task-scoped): 6/6 pass, 0 findings
- Dim 3 testing (CHECK-I16, I17): 2/2 pass, 2 findings (improvement)
- Dim 4 code-quality (CHECK-I11, I13–I15): 4/4 pass, 0 findings

## Summary
- Total findings: 2
- Gaps: 0
- Inconsistencies: 0
- Improvements: 2
- Errors: 0

Implementation is faithful and complete. The 17-token substitution contract is byte-exact across SKILL.md ≡ 00 §4.1 ≡ actual template tokens. All 7 phases, component-gated emission, never-clobber provenance, latest-version policy, diagram delegation-by-vendoring (CONTRACT_VERSION 1.0.0), 3 deploy targets + monorepo, and drift-guard parity are all present and traceable to P0 requirements. The tool is registered correctly and emits byte-identically to all 5 agent targets (goldens match live adapters; drift gate green). The single skipped test (duplicate-slug) is justified and documented in three concordant places — a legitimate JSON-Schema limitation delegated to the symlinker/drift-guard, not a coverage gap.

## Findings

### V-001: Reject-case assertions check only the boolean, not the failing rule
- **Severity:** improvement
- **Location:** src/test/doc-site-templates.test.ts:148-155
- **Issue:** The four `rejects %s` schema cases assert only `validate(load(name)) === false`, not *which* keyword failed. Fixtures are currently well-isolated (each violates exactly one §2.2 rule and is otherwise valid), so today each rejects for the intended reason. But a future schema edit could make a fixture reject for an unrelated reason while the test stays green, silently eroding rule-discrimination coverage. The accept cases guard against over-strictness; the reject cases lack the symmetric guard.
- **Suggested fix:** For each reject fixture, additionally assert the error keyword/instancePath (e.g. `validate.errors!.some(e => e.instancePath.includes('/pages/0') && (e.keyword === 'required' || e.keyword === 'additionalProperties'))`, tuned per fixture), or snapshot `validate.errors`. Keep `allErrors: true` (already set).
- **References:** spec 10 §4.3 rule-per-fixture mapping; 00 §2.2 rules 1/2/4/6
- **Checklist:** CHECK-I17

### V-002: `format: "uri"` in the manifest schema is silently ignored by ajv (untested constraint)
- **Severity:** improvement
- **Location:** skills/doc-site-plugin/references/docs.manifest.schema.json (`site.social.additionalProperties`, plus any `SITE_URL`/`GITHUB_URL` string fields); surfaced as test stderr `unknown format "uri" ignored in schema at path "#/properties/site/properties/social/additionalProperties"`
- **Issue:** Ajv2020 is constructed `strict: false` without `ajv-formats`, so every `format: "uri"` is a no-op. The schema advertises a `format` constraint the test suite never exercises, and no fixture covers URI-shape validation. Not a §2.2-rule gap (the load-bearing keyword-based rules 1/2/4/6 ARE enforced) — but the schema implies a constraint nothing enforces.
- **Suggested fix:** Decide whether manifest URL fields should be format-validated. (a) If yes → register `ajv-formats` in the test, add a valid-URI-accepts / malformed-URI-rejects fixture pair; (b) if advisory-only → drop `format:"uri"` from the schema or annotate it as documentation-only. Note tech-spec §9 frames `ajv` as the *only* added devDep, which argues for (b).
- **References:** spec 10 §4.3; tech-spec §9 (devDep policy); 00 §2.2
- **Checklist:** CHECK-I17

## Fix Execution Plan

### User Decisions Required
- **V-002:** ✅ RESOLVED (user, 2026-06-19) → **option (b): drop/annotate `format:"uri"`.** Do NOT add `ajv-formats`; keep `ajv` as the only added devDep per tech-spec §9. Remove `format:"uri"` from the schema, or replace it with a description noting the field is advisory/documentation-only and that URL-shape is not validated here.

### Execution Steps

#### Step 1: Strengthen reject-case assertions to verify the failing rule (V-001)
- **Files:** src/test/doc-site-templates.test.ts (lines 148-155)
- **Action:** After each failed `validate()`, capture `validate.errors` and assert the expected keyword/instancePath per fixture (required→missing `source`/`from`; additionalProperties→unknown key), or snapshot `validate.errors`. Keep `allErrors: true`.
- **Depends on:** none

#### Step 2: Resolve the ignored `format:"uri"` constraint (V-002)
- **Files:** skills/doc-site-plugin/references/docs.manifest.schema.json (option b) OR src/test/doc-site-templates.test.ts + package.json devDeps (option a)
- **Action:** Per the user decision above.
- **Depends on:** User decision in "User Decisions Required"

Both findings are improvement-level; neither blocks the implementation. No adversarial-confirmation pass was run (reserved for error/gap-severity findings; none were produced).

## Fix Progress

- Step 1: [APPLIED] 2026-06-19 — V-001: reject-case `it.each` in src/test/doc-site-templates.test.ts now asserts the intended ajv error keyword per fixture (required / not / additionalProperties), empirically verified against ajv output. 12 passed / 1 skipped.
- Step 2: [APPLIED] 2026-06-19 — V-002 (option b): removed `format:"uri"` from docs.manifest.schema.json `site.social.additionalProperties` and annotated the `social` description as advisory-only (URL shape not schema-validated). No `ajv-formats` added; ajv remains the only devDep. Rebuilt adapters (all 5 schema copies updated), `build:check` drift-clean, full suite 467 passed / 1 skipped.
