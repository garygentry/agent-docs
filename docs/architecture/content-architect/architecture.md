# content-architect — architecture

## Design goals

- **Accuracy is the through-line.** Documentation is derived from ground truth, never
  invented. Anything unverifiable is recorded as a gap, not asserted.
- **Endpoint-agnostic.** The output is a DocPlan, never a container.
- **Composes, does not duplicate.** Prose style stays in `docs-helper`; rendering stays in
  the endpoints; diagram drawing stays in `diagram-generator`.

## The DocPlan contract

The DocPlan is an engine-neutral JSON artifact — to documentation what `DiagramSpec` is to
diagrams. It is authored by the skill and consumed by the endpoints. The schema is
hand-authored JSON Schema (Draft 2020-12) shipped at
`skills/content-architect/references/docplan.schema.json` and copied verbatim into target
repos beside the emitted `docs/docplan.json`.

Corpus-level fields: `version`, `provenance`, `scope` (`end-user` | `architecture` |
`both`), `project` (`{name, kind, summary}`), `audiences[]`, `sources[]`, `documents[]`,
`grouping[]`, `gaps[]`.

Each `DocPlanEntry` carries `id`, `title`, `slug`/`path`, a `family`
(`diataxis` | `architecture`) discriminating a single `type`, `audience[]`, `purpose`,
`sourceRefs`, `outline[]`, `status`, `priority`, optional `diagrams[]`, and optional
`verification`.

Two invariants are load-bearing and encoded in the schema description:

- **Single mode per document** — exactly one `type`; the `family`/`type` discriminator is
  enforced with conditional subschemas.
- **Accuracy** — claims trace to `sources[]`; the unverifiable lands in `gaps[]`.

## Why the schema is a static asset (not a build input)

The top-level `schemas/` directory holds JSON Schemas **generated** from Zod sources in
`src/` and drift-guarded by `bun run schema:check` — those are _build inputs_
(`diagram-input`, `tools.manifest`). The DocPlan is different: it is a contract consumed
inside _target_ repos at plan time, not an input to this repo's emitter. So it follows the
`doc-site` precedent (`docs.manifest.schema.json`) — a hand-authored static schema shipped
in the skill's `references/` — rather than the Zod-generated pipeline. This keeps the build
graph unchanged and the schema colocated with the skill that owns it.

## Composition edges

- **doc-site (shipped)** — consumes a DocPlan to generate the sidebar and page stubs in
  their assigned modes instead of guessing the IA during its interview. `grouping` maps
  onto doc-site's `docs.manifest.json` sidebar model (ordered groups → ordered pages) via
  the documented adapter in `skills/doc-site/references/content-plan.md`: each `grouping`
  section is normalized to a slug first-segment so `buildSidebar()`'s implicit,
  prefix-derived grouping reproduces the plan's explicit sections in order.
- **readme-author (planned)** — invokes content-architect as the upstream content/accuracy
  step, then keeps owning README structure and section order.
- **docs-helper** — receives drafted prose for the house-style pass (opt-in Phase 6).
- **diagram-generator** — receives `diagrams[]` prose requests during drafting; only
  components verified in source are described.

The doc-site/readme-author integration and the Phase 6 drafting implementation are tracked
in the hand-off queue in
`plans/review-plans-docs-architect-spec-md-for-inherited-thacker.md`.
