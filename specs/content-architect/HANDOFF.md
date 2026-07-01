# content-architect — implementation hand-off

> Status: skill **core is merged to `main`** (commit `8e7d19d`). This document captures the
> remaining work to complete the spec in `plans/docs-architect-spec.md`. Each item below is
> independently shippable as its own branch/PR against the current `main`.

## What already exists (do not redo)

The content-strategy layer is live and green:

- `skills/content-architect/SKILL.md` — six-phase workflow (ground → frame → structure →
  verify → emit → opt-in draft) with the accuracy / single-mode / endpoint-agnostic
  invariants.
- `skills/content-architect/references/`
  - `research.md`, `diataxis.md`, `architecture.md` — the mining playbook and the two spines.
  - `docplan.schema.json` — the **DocPlan** contract (hand-authored JSON Schema, Draft
    2020-12). This is the integration seam every item below builds on.
  - `examples/{end-user,architecture}.docplan.json` — two validated worked plans.
  - `templates/*.md` — six mode-pure page skeletons.
- Registered in `tools.manifest.json`; emitted to all five targets; drops recorded in
  `adapters/GENERATION-REPORT.md`.
- Docs: `README.md` (skills table + three-layer model), `specs/content-architect/{PRD,tech-spec}.md`,
  `docs/architecture/content-architect/{README,architecture}.md`, and a pipeline
  cross-reference in `skills/docs-helper/SKILL.md`.

## Ground rules for every item (repo conventions)

- **Canonical source only.** Edit `skills/<name>/SKILL.md` + `references/`. Never hand-edit
  anything under `adapters/**` or `.claude-plugin/**` — those are generated.
- **Build + gate after every change:** `bun run build` then `bun run gate`. If you edit the
  `docs-helper` sample or any golden-scoped file, regenerate goldens with
  `bun run src/test/regenerate-goldens.ts` and review the diff.
- **YAML frontmatter gotcha:** a `: ` (colon-space) inside an unquoted `description:` scalar
  breaks the emitter's YAML parser. Use em-dashes or quote the string.
- **`metadata`/`argument-hint` survive the claude target only** — expected; the drop is
  recorded automatically in `adapters/GENERATION-REPORT.md`.
- **Cross-skill composition pattern** (mirror `readme-author`): reference a sibling skill by
  fixed relative path (`../<skill>/...`) and/or instruct the agent to invoke the sibling
  Skill. `readme-author` *reuses* `docs-helper` by pointing at its `references/style-guide.md`
  rather than restating it — reuse, don't duplicate.
- **DocPlan home in a target repo:** `docs/docplan.json`, or the `doc-site` docs-package dir
  beside `docs.manifest.json` when one exists. Validate with:
  `npx --yes ajv-cli@5 validate --spec=draft2020 -s <schema> -d <plan>`.

---

## Item 1 — `doc-site` consumes a DocPlan (largest win)

**Goal:** when a DocPlan exists (or by invoking `content-architect`), `doc-site` uses it to
generate the **sidebar** and **page stubs** in their assigned modes, instead of guessing the
information architecture during its interview.

**Where it plugs in:** `doc-site`'s phased workflow is detect → interview → component-select
→ emit → setup-docs → smoke-test (`skills/doc-site/SKILL.md`). Add a content-planning step
early (after detect, feeding interview/emit).

**Key mapping — DocPlan `grouping` → `docs.manifest.json` `pages`:**

- `doc-site`'s manifest contract lives at `skills/doc-site/references/docs.manifest.schema.json`
  and `references/manifest-schema.md`; the sidebar is derived at **build time** from
  `pages[]` order by `buildSidebar()` (see `references/core.md`), with groups auto-derived
  from slug prefixes.
- DocPlan `grouping` is ordered `{title, documents[]}` sections; each `DocPlanEntry` has a
  `slug`/`path`, a `title`, and a single `type` (mode).
- Map each `grouping` section to a slug-prefix group and each `DocPlanEntry` to a `pages[]`
  entry (`slug`, `label` from `title`, `source: "native"` for a fresh stub). Preserve DocPlan
  order → sidebar order.
- If the shapes don't map 1:1, add a **small, documented adapter** rather than bending either
  contract (spec §9). Document any group-label vs slug-prefix reconciliation.

**Page stubs:** seed each stub from the matching `references/templates/<mode>.md` so the
emitted page is mode-pure. Honor `doc-site`'s never-clobber policy (managed-file checksums in
`.doc-site-scaffold.json`).

**Deliverables:** edits to `skills/doc-site/SKILL.md` + a new `references/` doc (e.g.
`content-plan.md`) describing the DocPlan→manifest adapter; update
`docs/architecture/content-architect/architecture.md` to mark the edge as shipped.

**Acceptance:** given a sample DocPlan, `doc-site` produces a `docs.manifest.json` whose
sidebar order and groups match the plan's `grouping`, with mode-pure stubs; `bun run gate`
green; doc-site smoke-test still builds.

---

## Item 2 — `readme-author` uses `content-architect` upstream

**Goal:** `readme-author` asks `content-architect` "what is this project, who is the README
for, and what must the quickstart actually show," grounded in real entry points and tests,
**before** it composes sections. `content-architect` improves _selection and accuracy_;
`readme-author` keeps owning README _structure_ and section order.

**Where it plugs in:** `readme-author`'s Phase 1 (detect) / Phase 2 (interview) in
`skills/readme-author/SKILL.md`. Add content-architect as the upstream content/accuracy step,
reusing the composition mechanism already there (it invokes siblings by relative path +
Skill; see `references/diagrams.md` for the pattern it uses with `diagram-generator`).

**Subset consumed:** the README only needs the `end-user` slice — `project.{name,kind,summary}`,
the primary `audiences[]`, the `sources[]` behind the quickstart (weight tests/integration
tests), and any `gaps[]` that should not be asserted in the README.

**Deliverables:** edits to `skills/readme-author/SKILL.md` + a short `references/` note on the
content-architect handshake; keep the existing `docs-helper` prose reuse intact.

**Acceptance:** `readme-author` pulls project kind/audience/quickstart facts from a DocPlan
(or a live content-architect call) and never asserts a `gaps[]` item as fact; `bun run gate`
green; README golden (if any) regenerated and reviewed.

---

## Item 3 — Phase 6 drafting (opt-in continuation)

**Goal:** implement the opt-in drafting continuation described in `SKILL.md` Phase 6: when the
user opts in, draft the content for each `DocPlanEntry`, honoring the single-mode invariant,
then delegate.

**Pipeline:** draft per entry (seed from `references/templates/<mode>.md`) →
hand prose to **`docs-helper`** for the house-style pass → hand each `diagrams[]` request to
**`diagram-generator`** (describe only components verified in source; preserve its
"draw only what you're told" rule). `content-architect` decides content and structure; it
delegates prose polish and diagram rendering rather than duplicating them.

**Deliverables:** expand Phase 6 in `skills/content-architect/SKILL.md` (keep the file under
~500 lines — push detail into a new `references/drafting.md` if needed); wire the two
delegations using the cross-skill pattern.

**Acceptance:** a drafted document traces every claim to `sourceRefs`, is mode-pure, passes a
`docs-helper` style pass, and any diagram request references only verified components.

---

## Item 4 — Behavioral evals + accuracy spot-checks (spec §12)

**Goal:** exercise the three modes of use on ≥2 genuinely different real repos (a library
with a public API **and** an internal service) to cover both spines and the `both` route.

**Scenarios:**

1. **Greenfield direct** — "document this codebase" → a scoped DocPlan with correct
   `project.kind`, sensible `audiences[]`, mode-pure `documents[]`, populated `sources[]`,
   and a non-empty `gaps[]` where the repo is genuinely ambiguous.
2. **Audit direct** — point at an existing docs directory → classify existing docs by mode,
   flag mode-mixing, propose a restructured `grouping`.
3. **Helper path** — invoke via `doc-site` (Item 1) and via `readme-author` (Item 2) → the
   DocPlan feeds the sidebar/stubs and the README content selection respectively.

**Accuracy spot-checks:** verify drafted claims trace to `sourceRefs`, and that anything
unverifiable landed in `gaps`/`verification` rather than being asserted.

**Note:** the repo has no eval harness for skills today (only the TS test suite). Validate
qualitatively + via schema validation + `bun run gate`. If you build any fixtures, keep them
under `specs/content-architect/` or a scratch dir — do not add network dependencies.

**Acceptance:** documented eval run notes for ≥2 repos; both spines and the `both` route
exercised; accuracy spot-checks pass.

---

## Suggested order & branching

1. Item 1 (doc-site) — highest value, exercises the schema end-to-end.
2. Item 2 (readme-author) — smaller, reuses the same handshake pattern.
3. Item 3 (drafting) — depends on nothing but benefits from 1–2 being real.
4. Item 4 (evals) — last; validates 1–3.

One branch/PR per item, each against `main`, each ending green on `bun run build` +
`bun run gate`. Update `docs/architecture/content-architect/architecture.md` to flip each
composition edge from "planned" to "shipped" as you land it.
