<!-- Working handoff for the doc-site Mintlify-renderer effort. Delete before the final PR review. -->

# Handoff — doc-site Mintlify renderer

Continue and complete adding **Mintlify** as an alternative renderer to the `doc-site` skill
(alongside Astro/Starlight). This document is the single source of truth for resuming the work.

## Status snapshot

- **Branch:** `feat/doc-site-mintlify-renderer` (already pushed; up to date with origin).
- **Existing PR:** #41 (`https://github.com/garygentry/agent-docs/pull/41`) is already open
  against this branch. **Any further commits to the branch update PR #41 automatically** — you
  do not open a second PR for the same branch→main. If a single fresh consolidated PR is wanted
  instead, close #41 first, then open a new one after the remaining items land.
- **Gate:** `bun run gate` is **green — 531 tests**. Existing Starlight goldens are byte-for-byte
  unchanged (default renderer is `starlight`).
- **Commits so far** (`git log --oneline main..HEAD`):
  - `feat` add Mintlify as an alternative renderer alongside Starlight
  - `test` add mintlify-native scaffold golden + fix top-level nav shape
  - `docs` describe the renderer fork in the architecture overview (README)
  - `test` add Mintlify content-sourcing (symlink) template + golden
  - `docs` document the renderer fork in architecture.md
  - `feat` support renderer coexistence via sequential distinct-dir runs
  - `test` pin the cross-renderer provenance merge (rerun.md §1.4)

## Mental model (how the feature is shaped)

`doc-site` is a **deterministic template-substitution engine** gated by a **component-selection
record**. A `renderer` axis (`starlight` | `mintlify` | `both`, default `starlight`) forks only
the **back half** of the pipeline. The **front half** — detect, DocPlan consumption, identity
interview, safety/confinement, provenance/re-run, and the content-sourcing symlink engine — is
renderer-neutral and shared.

- **Starlight** path: `templates/core/**` + top-level `references/*`; `docs.manifest.json` →
  build-time sidebar. No `src/` emitter (mechanics modeled only in the golden-test harness).
- **Mintlify** path: `templates/mintlify/**` + `templates/mintlify-symlink/**` +
  `references/mintlify/*`; `docs.json` `navigation` generated at emit time. Small pure-logic
  modules live in `src/mintlify/{navigation,validate,emit}.ts` (unit-tested, reused by the golden
  harness's `mintlifyScaffold` branch).
- **`both`** is **not** a dual-emitter: it is two ordinary single-renderer runs into two
  **distinct** `{{DOCS_PKG_DIR}}`s over one shared content source. A same-dir guard
  (`SAME_DIR_RENDERER_CONFLICT`, detect.md Probe 8) refuses two renderers in one directory; the
  second run **merges** the shared repo-root `.doc-site-scaffold.json` (rerun.md §1.4).

Key design decisions (do not relitigate): adapt Mintlify nav from the **engine-neutral DocPlan**
(not the lossy Starlight manifest); **content is single-sourced** (only container chrome forks);
`both` = coexistence via sequential runs, not a monolithic emit.

## Where things live

| Area | Path |
| --- | --- |
| Skill orchestration + token tables | `skills/doc-site/SKILL.md` |
| Interview (Q0 renderer + Mintlify params) | `skills/doc-site/references/interview.md` |
| Detection (Probe 8 + same-dir guard) | `skills/doc-site/references/detect.md` |
| Provenance / re-run / coexistence merge | `skills/doc-site/references/rerun.md` (§1.4) |
| Mintlify references (8) | `skills/doc-site/references/mintlify/*.md` |
| Mintlify templates | `skills/doc-site/references/templates/mintlify/**`, `.../templates/mintlify-symlink/**` |
| Mintlify emit logic + tests | `src/mintlify/{navigation,validate,emit}.ts`, `src/mintlify/mintlify.test.ts` |
| Golden harness (renderer-aware) | `src/test/doc-site-scaffold.shared.ts` (GROUPS, deriveTokens, ANSWER_SETS), `src/test/doc-site-final-scaffold.shared.ts` (`mintlifyScaffold` branch) |
| Scaffold goldens | `src/test/__scaffold_golden__/{mintlify-native,mintlify-symlink}/**` |
| Coexistence test | `src/test/doc-site-coexistence.test.ts` |
| Token-coverage (partitioned) test | `src/test/doc-site-templates.test.ts` |
| Architecture docs | `docs/architecture/doc-site/{README,architecture}.md` |

## Remaining items (prioritized)

### 1. On-disk merged-provenance golden for sequential runs (medium)
The coexistence test models and asserts the provenance merge (union `files`, preserve pins), and
proves distinct-dir file-disjointness — but it does **not** materialize a two-run sequence to a
committed golden tree. To close this:
- Teach the golden harness to model a **second run over an existing tree**: extend
  `finalScaffold` (or add a `finalScaffoldOnto(existingProvenance, answers)`) that reads a prior
  `.doc-site-scaffold.json`, applies the never-clobber decision table + the §1.4 merge, and emits.
- Add a `both`/sequential answer pair (Starlight→`docs/`, Mintlify→`docs-mintlify/`, both
  `symlink` mode against a shared `docs-src/`) and a committed golden showing the merged
  provenance + both containers.
- **Acceptance:** golden shows one `.doc-site-scaffold.json` with both `docs/*` and
  `docs-mintlify/*` entries and the Starlight pins; a re-run of either renderer is a no-op diff.
- **Watch out:** don't break the existing 4 Starlight goldens or the `mintlify-native/symlink`
  ones; `finalScaffold`'s current signature is `(answers, preexisting)`.

### 2. DocPlan-driven Mintlify nav golden (low–medium)
`buildNavigationFromSections` / `buildTabbedNavigation` are unit-tested but not exercised by a
scaffold golden (the golden harness feeds `pages`, not a DocPlan — same as the Starlight side,
whose content-plan adapter is agent-only). Optional: add a unit-level "DocPlan → docs.json"
fixture test in `src/mintlify` that runs a small DocPlan through the adapter shape and asserts the
`groups`/`tabs` output + an OpenAPI tab. **Acceptance:** a `scope: both` DocPlan yields two tabs;
a `sources[type:api]` + `apiDocs` yields an `openapi` nav entry with no page stubs.

### 3. api-reference.md token tables (low)
`docs/architecture/doc-site/api-reference.md` still documents the Starlight token set only. Add the
Mintlify token set (`MINT_THEME`, `MINT_PRIMARY`, `MINT_COLOR_LIGHT`, `MINT_COLOR_DARK`,
`MINT_NAVIGATION`) and note the shared symlink-layer tokens. SKILL.md is already authoritative and
current — this is doc parity. Also fix the stale "17 canonical tokens" / "Seven probes" mentions if
still present.

### 4. Live `mint`-CLI smoke (needs `npm i -g mint`) (low, manual)
Scaffold a throwaway repo for each of: mintlify-native, mintlify-symlink, an OpenAPI repo, and a
`both` pair; run `mint dev` / `mint validate` / `mint broken-links`; confirm pages render and links
resolve. Verify the **Mintlify-cloud symlink** open question in `content-sourcing.md` (does the
hosted git build follow symlinks? if not, use the inverted layout). This can't run in CI without
the CLI; capture findings back into `references/mintlify/verify.md` / `content-sourcing.md`.

### 5. Final review polish (low)
- Decide whether to delete this handoff file before the final PR (it is committed under
  `specs/doc-site-mintlify/`).
- Re-read `references/mintlify/content-sourcing.md` line ~14 ("via the shared setup-docs.sh") —
  Mintlify now has its own `mintlify-symlink/setup-docs.sh`; tighten the wording if desired.

## Dev workflow & gotchas (read before editing)

- **After editing anything under `skills/**`:** regenerate the per-target adapters —
  `bun run build` — then the adapter goldens — `bun run src/test/regenerate-goldens.ts`. The gate's
  `build:check` and `golden.test.ts` fail if these are stale.
- **After changing scaffold emit/templates/fixtures:** regenerate scaffold goldens —
  `bun run src/test/regenerate-scaffold-goldens.ts` — and review the diff.
- **Formatting:** `bunx prettier --write <files>` (the gate runs `prettier --check`). Prettier
  reformats markdown tables and will mangle illustrative ```yaml fences containing placeholders —
  use plain fences / bullet lists for non-literal frontmatter examples.
- **Token discipline:** every `{{TOKEN}}` under `templates/mintlify/**` must be in the Mintlify or
  shared token set and appear in SKILL.md; `templates/mintlify-symlink/**` counts as a non-Mintlify
  group for the partition check (it uses only shared tokens). See `doc-site-templates.test.ts`.
- **Golden harness:** `GROUPS` (in `doc-site-scaffold.shared.ts`) gates template groups by the
  selection record; `finalScaffold` (in `doc-site-final-scaffold.shared.ts`) is the hand-written
  model of the emitted tree that goldens assert against — the Mintlify branch is `mintlifyScaffold`.
- **Full gate:** `bun run gate` (compile, schema:check, typecheck, lint, format, test, build:check,
  build:diagram:check). Always finish green.
- **Never commit on `main`.** Stay on `feat/doc-site-mintlify-renderer` (it already has PR #41).

## Verify

```sh
bun run gate            # must be green (currently 531 tests)
bun run vitest run src/mintlify src/test/doc-site-coexistence.test.ts src/test/doc-site-templates.test.ts
```
