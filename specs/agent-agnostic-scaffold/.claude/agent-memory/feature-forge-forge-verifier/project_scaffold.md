---
name: project-scaffold
description: agent-agnostic-scaffold feature — purpose and the contract tensions to watch in downstream tech/specs verification
metadata:
  type: project
---

agent-agnostic-scaffold is the foundational feature of the agent-docs repo: a canonical-core + adapters authoring system. Claude-native form is canonical; an emitter transforms it into committed in-repo adapters for Codex/Cursor/Gemini/Copilot, guarded by a drift check.

**Why:** It is the prerequisite workshop on which all later doc tooling is built; the actual doc tools are out of scope (OOS-01). Stack is mandated Bun+TypeScript (CON-01); repo had no package.json at PRD time.

**How to apply:** When verifying the tech spec / specs for this feature, carry forward the two unresolved PRD tensions (see [[prd-patterns]]): (1) byte-stability REQ-EMIT-06 vs override-merge REQ-EMIT-04 — confirm the determinism contract names overrides as an input and the drift guard re-applies them; (2) no tool-deletion cleanup requirement existed in PRD v1 — verify the tech spec adds stale-output removal or the drift guard will rot. OQ-01 (per-target transform rules) and OQ-03 (override merge semantics) are the load-bearing open questions the tech spec must close.
