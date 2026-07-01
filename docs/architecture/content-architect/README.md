# content-architect

Plan a project's documentation before anything is rendered: analyze the source for ground
truth, fix the audience, purpose, and scope, decide which documents should exist and in
what mode, verify every claim against source, and emit a typed, engine-neutral **DocPlan**.

This is the **content-strategy** layer of agent-docs. It sits between "we should document
this" and a rendered site or README, and it composes with its neighbors in sequence:

```text
content-architect  →  docs-helper  →  doc-site / readme-author
   (what & where)       (how it reads)      (the container)
```

- content-architect decides **what a document says and where it sits in the corpus**.
- `docs-helper` makes each **sentence** read to house style.
- `doc-site` / `readme-author` / `diagram-generator` **render** the container.

The seam between them is the **DocPlan** — a typed information-architecture spec that
content-architect authors and the endpoints consume.

## Integration status

All four composition edges are implemented (see [`architecture.md`](./architecture.md) for
the shipped-edge detail):

- **`doc-site`** consumes a DocPlan for its sidebar + mode-pure page stubs —
  `skills/doc-site/references/content-plan.md`.
- **`readme-author`** runs content-architect upstream for the `end-user` content/accuracy
  slice — `skills/readme-author/references/content-architect.md`.
- **`docs-helper`** and **`diagram-generator`** receive prose and diagram requests during
  the opt-in Phase 6 drafting continuation —
  `skills/content-architect/references/drafting.md`.

Worked, schema-validated evidence for both spines and the `both` route lives in
[`specs/content-architect/evals/`](../../../specs/content-architect/evals/).

> This document is the architecture reference for maintainers. For the DocPlan contract
> itself, see [`architecture.md`](./architecture.md) and the schema at
> `skills/content-architect/references/docplan.schema.json`.
