# Content Architect — Technical Specification

> Slug: `content-architect` · Stage: tech v1 · Based on: PRD v1
> Stack: Claude-native skill (Markdown + static JSON Schema), emitted to all five targets

## 1. Overview

`content-architect` is a canonical **skill** authored in this repo and emitted to all five
agent targets. It is a judgment skill in the register of `frontend-design` — persona-framed
and prose-forward, not a mechanical transform. Its deliverable is a **DocPlan**: a typed,
engine-neutral information-architecture spec, to documentation what `DiagramSpec` is to
diagrams.

Key decisions:

- **DocPlan schema is a static asset, not a build input.** It ships as
  `skills/content-architect/references/docplan.schema.json` (hand-authored JSON Schema,
  Draft 2020-12), mirroring `doc-site`'s `docs.manifest.schema.json`. It is a contract
  consumed inside _target_ repos, so it is **not** wired into `src/`'s Zod → `schemas/`
  drift pipeline (that pipeline is reserved for build inputs like `diagram-input`).
- **Primarily a helper with a thin direct entry**, mirroring `docs-helper`.
- **Progressive disclosure** — `SKILL.md` stays under ~500 lines; frameworks live in
  `references/` and are pulled in per phase.

## 2. Structure

```text
skills/content-architect/
  SKILL.md                         Persona + six-phase workflow + invariants
  references/
    research.md                    Phase 1 source-of-truth mining playbook
    diataxis.md                    end-user spine (four modes, single-mode rule)
    architecture.md                architecture spine (C4 + arc42 + ADRs)
    docplan.schema.json            DocPlan contract (Draft 2020-12), shipped to target repos
    examples/
      end-user.docplan.json        worked end-user plan (validates)
      architecture.docplan.json    worked architecture plan (validates)
    templates/                     mode-pure page skeletons (tutorial, how-to, reference,
                                   explanation, adr, arc42-chapter)
```

## 3. Workflow (six phases)

1. **Ground/analyze** — network-free static analysis in reliability order; record
   `sources[]`.
2. **Frame** — determine `project.kind` and `audiences[]`; minimal interview; route `scope`.
3. **Structure** — Diátaxis (`end-user`) or C4 + arc42 + ADRs (`architecture`); populate
   `documents[]` + `grouping`.
4. **Verify** — cross-check claims against `sources[]`; record `gaps[]` / `verification`.
5. **Emit** — write `docs/docplan.json` (or the docs-package dir); copy the schema
   alongside; validate.
6. **Draft (opt-in)** — draft content, delegate prose to `docs-helper` and diagrams to
   `diagram-generator`. Deferred to the hand-off queue for implementation depth.

## 4. Emission

Registered in `tools.manifest.json` as `{name, type, source, description}`. `metadata`
(including `argument-hint`) survives the **claude** target only; codex/gemini keep
`{name, description}`; copilot/cursor drop metadata. This is expected and recorded in
`adapters/GENERATION-REPORT.md`. `references/` (schema, spines, examples, templates) copies
verbatim to every target.

## 5. Validation

Both example DocPlans validate against `references/docplan.schema.json` via ajv
(Draft 2020-12, no formats) — the same validator `doc-site` uses for its manifest.
`bun run build` + `bun run gate` must pass with no unexpected drift.
