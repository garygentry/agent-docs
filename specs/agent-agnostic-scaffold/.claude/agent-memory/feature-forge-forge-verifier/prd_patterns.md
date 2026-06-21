---
name: prd-patterns
description: Recurring PRD verification findings to watch for in this project's feature-forge PRDs
metadata:
  type: feedback
---

Recurring PRD gap/tension classes observed in this project. Check these first on future PRD verifications.

**Why:** These PRDs are well-written at the section level but tend to leave *contract* and *lifecycle* edges implicit.

**How to apply:** On any PRD with an emitter/transform/codegen + a drift/idempotency guarantee, specifically probe:
- Byte-stable/idempotent output requirements vs. author-override/merge requirements — the override bytes are an input the determinism clause usually forgets to name (CHECK-P15). Check the drift guard re-applies overrides before diffing.
- Lifecycle deletion/rename: what happens to generated output when a source/manifest entry is removed? Idempotent emitters that never delete stale output silently defeat their own drift guard (CHECK-P14).
- "best-effort / where possible" fallback requirements are not testable as written — push the hard, testable part (always emit a coverage-report entry) separate from the judgment part (CHECK-P08).
- Delivery-mechanism mandates ("MUST run in CI") sitting in functional requirements rather than Constraints (CHECK-P09) — often intentional; confirm with user rather than auto-rewording.

These PRDs reliably populate all template sections and avoid TBDs, so CHECK-P01/P02/P03/P04 are usually clean — spend effort on P08/P09/P14/P15 instead.
