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

> This document is the architecture reference for maintainers. For the DocPlan contract
> itself, see [`architecture.md`](./architecture.md) and the schema at
> `skills/content-architect/references/docplan.schema.json`.
