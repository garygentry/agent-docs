# Content Architect — Product Requirements Document

> Slug: `content-architect` · Stage: prd v1 · Source spec: `plans/docs-architect-spec.md`

## 1. Problem Statement

agent-docs has two kinds of skill: **endpoint** skills that each own a deliverable
(`doc-site`, `readme-author`, `diagram-generator`) and one **style** helper
(`docs-helper`). Nothing owns the layer between them — deciding **what** should be
documented, **for whom** and **why**, **sourced from what ground truth**, and
**organized into what information architecture**.

Without that layer, endpoints guess the information architecture during their interview,
and there is no shared, accuracy-checked plan of the documentation corpus. A generic
writing model can produce prose; what is missing is a step that produces _correct,
well-placed_ documentation derived from the code itself.

## 2. Goal

Add a `content-architect` skill — the content-strategy layer — that analyzes a repo's
ground truth, frames audience/purpose/scope, decides which documents should exist and in
what mode, verifies each claim against source, and emits a typed, engine-neutral
**DocPlan** for the endpoint skills to render.

## 3. Users

- **Direct user** — an engineer who wants to document a codebase or audit existing docs
  and needs a plan before rendering anything.
- **Endpoint skills** — `doc-site` and `readme-author` invoke it as a helper to obtain a
  DocPlan (or the relevant subset) before they render.

## 4. Functional Requirements

- `REQ-PLAN-01` — Emit a DocPlan validating against `docplan.schema.json` (Draft 2020-12).
- `REQ-PLAN-02` — Route `scope` to `end-user`, `architecture`, or `both` from analysis and
  a minimal interview.
- `REQ-SRC-01` — Derive ground truth network-free from entry points, manifests, public
  API, tests (weighted heavily), config, data models, CI, and history; record `sources[]`.
- `REQ-ACC-01` — Never assert unverifiable claims; record them in `gaps[]` or per-document
  `verification`. `gaps[]` must not be silently empty when uncertainty exists.
- `REQ-MODE-01` — Every `DocPlanEntry` has exactly one `type` (single-mode invariant).
- `REQ-KIND-01` — `project.kind` aligns with `readme-author` detection plus `service`.
- `REQ-IA-01` — `grouping` maps onto `doc-site`'s sidebar model.
- `REQ-DRAFT-01` — Drafting document content is an opt-in continuation, delegating prose to
  `docs-helper` and diagrams to `diagram-generator`.

## 5. Boundaries / Non-goals

- Not prose style (that is `docs-helper`).
- Not a container (endpoints render sites, READMEs, images).
- Not a fact generator — unverifiable content goes to `gaps`, never into a document.
- Network-free and additive; writes only inside the target repo, never clobbers edits.

## 6. Out of scope for the first pass (hand-off queue)

- `doc-site` and `readme-author` integration edits.
- Phase 6 drafting implementation.
- Behavioral evals across real repos.

See `plans/review-plans-docs-architect-spec-md-for-inherited-thacker.md` for the tracked
hand-off queue.
