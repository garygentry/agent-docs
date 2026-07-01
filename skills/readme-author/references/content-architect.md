# content-architect handshake (agent reference)

Before composing a README, ground its **content and accuracy** in a
`content-architect` **DocPlan** — the same content-strategy layer `doc-site` consumes.
`content-architect` decides _what_ the project is, _who_ the docs are for, and _what the
quickstart must actually show_, sourced from real entry points and tests. `readme-author`
keeps owning README **structure and section order** (`references/structure.md`); it just
stops guessing the facts it can get from the plan.

This is a **content/accuracy** step, not a structure step. Think of it as the upstream
sibling of the `diagram-generator` handshake (`references/diagrams.md`): reach the sibling
skill by a fixed relative path, consume a typed artifact, degrade gracefully when it is
absent.

## 1. When to run it

Run this in **Phase 1 (detect)**, before the Phase 2 interview — a good DocPlan removes
questions rather than adding them.

1. Look for an existing DocPlan at `docs/docplan.json` (or beside a `doc-site`
   `docs.manifest.json`). If found, validate and consume it — no new call needed.
2. If none exists and the project is non-trivial, **invoke the sibling `content-architect`
   skill** (Skill tool) to obtain a DocPlan — or, more cheaply, ask it for just the
   `end-user` slice below. The sibling lives at the uniform relative path
   `../content-architect/` in every adapter bundle, with its contract in
   `../content-architect/references/docplan.schema.json`.
3. If content-architect is unavailable or the user declines, **skip gracefully** and fall
   back to plain detection + interview. The handshake is additive; never block README
   authoring on it.

## 2. The subset a README consumes (the `end-user` slice)

A README needs only a thin slice of the DocPlan — do not pull the whole architecture spine:

| DocPlan field                     | README use                                                                                                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project.name`, `project.summary` | the hero title and `>` tagline / lede — accurate wording, not a guess                                                                                          |
| `project.kind`                    | selects the structure variant (`library` / `app` / `cli` / `framework` / `service` → app-or-CLI). Aligns 1:1 with `references/structure.md`.                   |
| primary `audiences[]`             | who the README addresses → tone and the "most important thing" in Phase 2                                                                                      |
| `sources[]` behind the quickstart | the ground truth for install/quickstart — **weight `type: test`, especially integration tests**, since they encode intended usage least likely to have drifted |
| `gaps[]`                          | the accuracy guardrail — see §3                                                                                                                                |

`project.kind` maps straight onto `readme-author`'s own project-type detection, so a DocPlan
resolves that axis authoritatively instead of by heuristic.

## 3. Accuracy rule — never assert a gap

Anything the DocPlan records in `gaps[]` (or a per-document `verification` note) is
**explicitly unverified**. The README must **not** assert it as fact: omit it, or phrase it
as a known limitation, but never state an unverified behavior, benchmark, or capability in
the hero, feature table, or quickstart. This is `content-architect`'s reason to exist —
honor it. When a quickstart step traces to a `sources[]` entry, you can present it plainly;
when it does not, treat it as a gap.

## 4. What stays with readme-author

The handshake improves **selection and accuracy**; it does not move ownership:

- Section order, hero convention, badge selection, `<picture>` diagram — all still
  `readme-author` (`structure.md`, `header-style.md`, `diagrams.md`).
- Prose house-style still comes from `docs-helper`'s style guide
  (`../docs-helper/references/style-guide.md`) — unchanged.
- The DocPlan is a planning input consumed at compose time; `readme-author` writes only the
  README (and any diagram assets), never the DocPlan.
