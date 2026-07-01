# Phase 6 — drafting (opt-in continuation)

The default `content-architect` deliverable is a **DocPlan**, not prose. Drafting the actual
document content is an **opt-in** continuation: run it only when the user explicitly asks you
to draft (not merely to plan). This file is the procedure.

The rule that governs the whole phase: **you decide content and structure; you delegate
prose polish and diagram rendering.** You draft accurate, mode-pure content from ground
truth, then hand it to the siblings that own style and images — you do not restate their
jobs.

## 0. Precondition

You have an emitted, schema-valid DocPlan (Phase 5) and explicit user opt-in. Draft only the
entries the user asked for (default: all `status: planned` entries, in `priority` then
`grouping` order). Skip `status: existing` entries unless the user asks to rewrite them.

## 1. Draft each entry from ground truth

For each `DocPlanEntry`, in order:

1. **Seed from the mode template.** Open `references/templates/<type>.md` and use it as the
   skeleton — it encodes the single-mode shape (a tutorial stays on-rails, a reference stays
   lookup-oriented, etc.). Fill its placeholders; do not add sections from another mode.
   - `type` → template: `tutorial` → `tutorial.md`, `how-to` → `how-to.md`,
     `reference` → `reference.md`, `explanation` → `explanation.md`, `adr` → `adr.md`,
     `arc42-chapter` → `arc42-chapter.md`. `c4-view` has no dedicated template — draft a
     concise structural description and lean on `references/architecture.md`.
2. **Follow the outline.** Draft the `outline[]` headings in order; each section serves its
   `intent`. If the entry has no outline, derive one from the mode template's section set.
3. **Trace every claim to a source.** Each factual statement must trace to a `sourceRefs`
   entry on the document or the section — re-read that source (entry point, test, schema)
   and write what it actually establishes. Weight `type: test` sources (especially
   integration tests) as the most reliable ground truth.
4. **Honor the accuracy invariant.** Never assert anything recorded in `gaps[]` or a
   per-document `verification` note. If drafting surfaces a new unknown, stop and add it to
   `gaps[]` rather than confabulating — a drafted document must not introduce a claim the
   DocPlan does not back.
5. **Stay single-mode.** Exactly one `type` per document (the schema already enforces this at
   plan time; drafting must not violate it — no reference tables inside a tutorial, no
   how-to steps inside an explanation).

## 2. Delegate the prose pass → `docs-helper`

Once an entry is drafted, hand the prose to the sibling **`docs-helper`** skill for the
house-style pass — one sentence per line, sentence-case headings, every fenced block declares
a language, realistic runnable examples. `docs-helper` reads its own
`references/style-guide.md`; do **not** restate style rules here. Reach it the same way the
other skills compose siblings — by fixed relative path and/or invoking the skill:

- Style guide: `../docs-helper/references/style-guide.md`
- Invoke `docs-helper` on each drafted file for the polish pass.

The boundary stays crisp: `docs-helper` may re-word a sentence, but it must not change a
claim or introduce a fact — accuracy remains yours. If a style edit would alter meaning,
reconcile it against `sources[]` before accepting.

## 3. Delegate diagrams → `diagram-generator`

For each `diagrams[]` request on an entry, hand the prose description to the sibling
**`diagram-generator`** skill. Preserve its core rule — **draw only what you are told**, i.e.
describe only components you verified in source (the request's own `sourceRefs`). Never
invent a box to fill the picture.

- Renderer: `../diagram-generator/scripts/diagram-render.mjs` (author a `DiagramSpec`, render
  to committed SVG). The renderer contract — flags, `--version` pin-check, exit codes — is
  owned by `diagram-generator`; follow its reference, do not restate it.
- On any renderer version mismatch or absence, surface it and skip that diagram; never
  substitute a fallback. The rest of the draft is unaffected.

## 4. Hand off to the endpoint

Drafted, polished content is still engine-neutral. If the user wants it rendered, hand off to
the endpoint that owns the container — `doc-site` (which can consume the same DocPlan for its
sidebar, `../doc-site/references/content-plan.md`) or `readme-author`. You draft; they render.

## Done criteria

A drafted document: traces every claim to `sourceRefs`; is mode-pure (one `type`); asserts
nothing from `gaps[]`; has passed a `docs-helper` style pass; and references only verified
components in any diagram request.
