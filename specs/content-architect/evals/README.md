# content-architect — behavioral eval run notes

This directory records the Item 4 evaluation from `specs/content-architect/HANDOFF.md`:
`content-architect` exercised against **two genuinely different real repos**, covering
**both spines** (`end-user` + `architecture`) and the **`both`** route, plus the two
direct scenarios (greenfield, audit) and the helper path (via `doc-site` and `readme-author`).

The repo has no skill-eval harness (only the TS suite), so evaluation is **qualitative +
schema-validated**, per the HANDOFF note. No network dependencies were added.

## Repos under test

| Repo                     | Kind        | Spine exercised           | Scenario                    |
| ------------------------ | ----------- | ------------------------- | --------------------------- |
| `rauf` (`@rauf/*`, v0.11.0) | `cli`       | `end-user` (Diátaxis)     | **Audit direct** — classify existing docs |
| `agent-docs` (this repo, v0.1.0) | `framework` | `both` (Diátaxis + C4/arc42/ADR) | **Greenfield direct**       |

Together they cover: the `end-user` spine (rauf), the `architecture` spine (agent-docs), the
`both` route (agent-docs), plus greenfield and audit direct entries, and the helper path.

## Artifacts

- `rauf.docplan.json` — end-user DocPlan for rauf, **audit** mode: existing docs are
  classified by mode (`status: existing`), the README's tutorial/reference mode-mixing is
  flagged (`status: needs-restructure` + a `gaps[]` note), and a restructured `grouping` is
  proposed.
- `agent-docs.docplan.json` — `both`-scope DocPlan for agent-docs, **greenfield**: a Diátaxis
  end-user spine (tutorial/how-to/reference) **and** an architecture spine (two `c4-view`, an
  `arc42-chapter`, and an `adr`), each `DocPlanEntry` single-mode.
- `rauf.docs.manifest.json` — the helper-path artifact: rauf's `grouping` run through the
  Item 1 `doc-site` adapter (`skills/doc-site/references/content-plan.md`) into a
  `docs.manifest.json`.

## Validation (reproduce)

Both DocPlans validate against the shipped schema, and the derived manifest validates against
doc-site's schema (ajv, Draft 2020-12, no formats — ignore the advisory `strict mode`
warnings):

```bash
cd specs/content-architect/evals
# DocPlans
npx --yes ajv-cli@5 validate --spec=draft2020 \
  -s ../../../skills/content-architect/references/docplan.schema.json \
  -d rauf.docplan.json -d agent-docs.docplan.json
# Helper-path manifest (Scenario 3)
npx --yes ajv-cli@5 validate --spec=draft2020 \
  -s ../../../skills/doc-site/references/docs.manifest.schema.json \
  -d rauf.docs.manifest.json
```

All three report `valid`.

## Scenario results

### 1. Greenfield direct — `agent-docs`

- `project.kind` resolved to `framework` (a source-to-multi-target emitter), justified by the
  `src/emit.ts` pipeline + `src/targets/` registry rather than guessed.
- `audiences[]`: `tool-author` and `maintainer` — the two real reader groups.
- `documents[]` are mode-pure: the Diátaxis entries stay in one mode each; the architecture
  entries use `family: architecture` with `c4-view` / `arc42-chapter` / `adr` types and the
  `family`/`type` discriminator holds (schema-enforced).
- `sources[]` is populated from real entry points, the manifest, `src/*` modules, and tests;
  every `DocPlanEntry.sourceRefs` points at a listed source.
- `gaps[]` is non-empty and specific: the diagram CLI's unverified contract, the empty
  `agents/`+`commands/` dirs, the TQ-4 name cross-check, and override-deletion semantics —
  each a genuine "not verifiable from source as a guarantee" item, not filler.

### 2. Audit direct — `rauf`

- Existing docs classified by mode: `docs/SPEC-CLI.md` → single-mode reference (maps 1:1),
  `docs/SPEC-BACKLOG-TOOL-CONTRACT.md` → how-to/reference, `README.md` → **mode-mixed**
  (tutorial + reference) and flagged `needs-restructure`.
- Proposed restructure: split the on-rails getting-started out of the README into
  `get-started/your-first-loop` (tutorial), keep reference in `reference/cli`; add an
  `explanation` for the RAUF_* signal model that the existing corpus only implies.
- `gaps[]` records the audit's real uncertainties: web-dashboard maturity, Gemini/Cursor
  agents being argv-verified only, and unverified RAUF_* log-redaction — none asserted as fact.

### 3. Helper path — `doc-site` (Item 1) and `readme-author` (Item 2)

- **doc-site:** `rauf.docs.manifest.json` was produced by applying the content-plan adapter to
  `rauf.docplan.json`'s `grouping`. Note the normalization: `d-first-loop`'s planned slug
  `get-started/your-first-loop` shares no first-segment with the section `slugify("Getting
  started") = getting-started`, so it is rewritten to `getting-started/your-first-loop` and
  the `group` override is set to the exact title `Getting started`. `buildSidebar()`
  (`skills/doc-site/references/core.md §2.2`) then yields groups **Getting started → Guides →
  Reference → Concepts** in that order — an exact image of the DocPlan `grouping`.
- **readme-author:** the `end-user` slice for a rauf README pulls
  `project.{name,kind,summary}`, the `operator` audience, and the quickstart `sources[]`
  (weighting `core-integration` — an integration test — over prose), and treats the four
  `gaps[]` items as **not-to-assert**: e.g. a rauf README must not claim full Gemini/Cursor
  agent parity, since the DocPlan records those as argv-verified only.

## Accuracy spot-checks

- Every factual `DocPlanEntry` claim traces to a `sourceRefs` entry that names a real file
  (verified during authoring against the two repos' entry points, schemas, and tests).
- Nothing recorded in `gaps[]` is asserted as fact in any entry's `purpose`/`outline`; the
  unverifiable consistently lands in `gaps[]` or a per-document `verification` note.
- Both plans keep the single-mode invariant: no entry mixes Diátaxis modes, and the
  architecture entries use only architecture `type`s under `family: architecture`.

## Conclusion

Both spines and the `both` route are exercised on two real, structurally different repos; both
DocPlans and the derived doc-site manifest are schema-valid; and the accuracy invariant
(claims trace to sources; the unverifiable lands in gaps) holds across both. The doc-site and
readme-author helper paths consume the plan as designed in Items 1–2.
