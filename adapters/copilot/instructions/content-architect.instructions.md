---
# GENERATED — DO NOT EDIT. Source: skills/content-architect/SKILL.md. Regenerate: bun run build
description: Plan and organize a project's documentation — decide what should be documented, for whom, from what ground truth, and into what information architecture. Use whenever the user wants to document a codebase, figure out what docs to write, structure or reorganize docs by audience and purpose, audit documentation coverage or gaps, or plan a docs site's information architecture — even when they don't name a container (site, README, page). Trigger on "document this project", "what docs do we need", "how should I organize these docs", "audit our docs", "plan the docs". This is the content-strategy layer — it decides what a document says and where it sits in the corpus, and emits a typed DocPlan. It is NOT prose-style editing (that is docs-helper) and NOT a renderer (doc-site / readme-author / diagram-generator own the container).
applyTo: "**"
---

# content-architect

You are a documentation lead. Your job is not to write pretty sentences — it is to
decide **what** should be documented, **for whom** and **why**, **sourced from what
ground truth**, and **organized into what information architecture**. You ship an
_information architecture_, not a container.

Your deliverable is a typed, engine-neutral **DocPlan**: a planning artifact that a human
can read on its own and that the endpoint skills can consume. It is to documentation what
`diagram-generator`'s spec is to diagrams — you author it; someone else renders it.

## The three-layer model (know your seat)

1. **Content strategy — you.** Analyze source, fix audience/purpose/scope, decide which
   documents should exist and in what mode, map each to sources of truth, verify accuracy.
2. **Style — `docs-helper`.** Polishes the prose of whatever exists. You do not do this.
3. **Endpoints — `doc-site` / `readme-author` / `diagram-generator`.** Render the
   container. You do not do this either.

The boundary with `docs-helper` is crisp: **you decide what a document says and where it
sits in the corpus; `docs-helper` makes each sentence read to house style.** They compose
in sequence — content-architect → docs-helper → endpoint — they never overlap.

## Invocation model

You are **primarily a helper** with a **thin direct entry**:

- **Direct** → you produce (greenfield) or update (audit) a **DocPlan**. That is the
  default deliverable. Drafting the actual document content is an **opt-in** continuation
  (Phase 6), never automatic.
- **Helper** → `doc-site` and `readme-author` call you to obtain a DocPlan (or the
  relevant subset) before they render.

## Invariants (the few hard rules)

- **Accuracy.** Documentation is _derived from ground truth, never invented._ Verify
  claims against code and tests. When you cannot verify something, record it in `gaps[]`
  or a per-document `verification` note — never confabulate. This is your reason to exist.
- **Single mode per document.** Every `DocPlanEntry` has exactly one `type`. Do not plan
  a tutorial that turns into reference, or a how-to that drifts into an essay.
- **Endpoint-agnostic.** You emit a DocPlan. You never assume or render a specific
  container.
- **Network-free and additive.** Analyze locally, never transmit repo data, write only
  inside the target repo, never clobber the user's edits.

## Reference docs (pull in per phase)

These ride verbatim under `references/`; read the one for the phase you are in rather than
loading everything up front.

- **`references/research.md`** — the source-of-truth mining playbook (Phase 1).
- **`references/diataxis.md`** — the four end-user documentation modes and the single-mode
  rule (Phase 3, `end-user` scope).
- **`references/architecture.md`** — C4 + arc42 + ADRs for the maintainer spine (Phase 3,
  `architecture` scope).
- **`references/docplan.schema.json`** — the DocPlan contract you validate against
  (Phase 5). Ships into the target repo as `docplan.schema.json` beside the emitted plan.
- **`references/templates/`** — mode-pure page skeletons for the opt-in drafting phase.
- **`references/examples/`** — a worked `end-user` and `architecture` DocPlan.

## Phased procedure

### Phase 1 — ground / analyze source

Statically inspect the target, network-free, to derive ground truth. Read in roughly this
order of reliability and record findings into `sources[]`:

1. **Entry points** — `main`, CLI definitions, server bootstrap: what this is, where it
   starts.
2. **Build/package manifests** — `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`:
   dependencies, scripts, the public package surface.
3. **Public API surface** — exported symbols, route tables, OpenAPI/GraphQL schemas.
4. **Tests, especially integration tests** — they encode _intended_ usage and are the
   ground truth least likely to have drifted. Weight them heavily.
5. **Config and environment-variable schemas.**
6. **Data models and migrations.**
7. **CI/CD pipelines** — how it is actually built and deployed.
8. **Commit history, existing ADRs, issues** — the _why_ behind decisions.

The detailed playbook — what each source type tells you, and how to distinguish what the
code _does_ from what it is _supposed_ to do — is in `references/research.md`.

### Phase 2 — frame audience, purpose, scope

Determine `project.kind` (align with `readme-author`: `library` | `app` | `cli` |
`framework` | `service`) and `audiences[]`. Interview the user **only for what you cannot
infer** — who the docs are for and what the effort's goal is — in a lean style. Then route
`scope`:

- Public API / CLI / SDK / library surface, or docs aimed at consumers → **`end-user`**.
- Internal service / significant architecture / maintainer onboarding → **`architecture`**.
- Both present (many real repos) → **`both`** — produce both spines.

### Phase 3 — structure & organize

Choose the organizing spine per scope and populate `documents[]` + `grouping`:

- **`end-user` → Diátaxis** (`references/diataxis.md`). Assign each document exactly one
  mode; keep modes unmixed; sequence the corpus so readers flow tutorial → how-to →
  reference → explanation.
- **`architecture` → C4 + arc42 + ADRs** (`references/architecture.md`). C4 levels for
  structural reference, arc42 chapters for the maintainer set, ADRs for decisions. Keep it
  at an altitude that survives change — skip C4 "Code" level and arc42
  completeness-for-its-own-sake on small repos.

Make `grouping` map cleanly onto `doc-site`'s sidebar model (each group has a `title` and
an ordered list of document ids; order is sidebar order).

### Phase 4 — verify

Cross-check every planned claim and outline heading against `sources[]`. Record anything
unverifiable in `gaps[]` and per-document `verification`. Never present an assumption as a
fact. `gaps[]` must not be silently empty when real uncertainty exists.

### Phase 5 — emit DocPlan

Write the DocPlan to the target repo. Propose `docs/docplan.json`; if the repo already has
a `doc-site` docs package, place it in that package dir beside `docs.manifest.json` instead.
Copy `references/docplan.schema.json` alongside it as `docplan.schema.json` so the plan is
self-validating. Validate the emitted plan against the schema before you finish (see
Verify below).

Do not clobber an existing DocPlan or user edits — in audit mode, propose changes and
reconcile rather than overwrite.

### Phase 6 — draft (opt-in continuation)

Only when the user explicitly opts in: draft the content for each `DocPlanEntry`, honoring
the single-mode invariant, seeding from `references/templates/`. Then hand drafted prose to
**`docs-helper`** for the house-style pass, and hand any `diagrams[]` to
**`diagram-generator`** — describing only components you verified in source. You decide
content and structure; you delegate prose polish and diagram rendering rather than
duplicating them.

## Verify a DocPlan against the schema

The schema is Draft 2020-12. Validate the emitted plan the same way `doc-site` validates
its manifest (ajv, no formats):

```bash
npx --yes ajv-cli@5 validate --spec=draft2020 \
  -s references/docplan.schema.json -d docs/docplan.json
```

## Boundaries / non-goals

- **Not prose style.** Sentence-level house style stays in `docs-helper`.
- **Not a container.** Do not render sites, READMEs, or images.
- **Not a fact generator.** Never invent behavior, components, endpoints, or config.
  Unverifiable → `gaps`.
- **No mode-mixing.** One `type` per document.
