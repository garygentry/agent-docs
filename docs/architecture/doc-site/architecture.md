# Architecture

How `doc-site` turns an agent-led interview into a working Astro + Starlight
documentation site in a target repo, why it is built the way it is, and where its
safety and determinism guarantees come from. This documents the **implemented**
skill (`skills/doc-site/`), cross-referenced to the design specs under
`specs/doc-site-plugin/`.

## Design goals (the "why")

Four constraints shape every decision below:

1. **Portability over cleverness.** The emitted file set must be **byte-identical**
   across every agent that runs the skill. So emission is pure global `{{TOKEN}}`
   replacement over fixed `.tmpl` assets, with **no in-template logic** — the agent
   substitutes and writes, it never authors plumbing content (`REQ-PORT-02`).
2. **Additive and reversible.** The feature must not touch the `src/` emitter or add a
   gate stage. It is a skill directory plus one `tools.manifest.json` entry; in the
   target repo it writes only managed files it can later recognize and never clobbers
   user edits.
3. **Single source of truth.** Sidebar, content symlinks, and the drift guard must not
   drift apart, so all three derive from one `docs.manifest.json`.
4. **Real verification.** "Done" means the emitted site actually installs and builds
   green in the target repo (`REQ-VERIFY-01`) — not that the right files were written.

A consequence worth stating up front: **there is no in-repo runtime module.** Unlike
`diagram-generator` (which has `src/diagram/*.ts`), this feature's "code" is the
SKILL.md procedure, the reference docs, the `.tmpl` assets, and the shell/CLI commands
the agent runs **at scaffold time in the target repo**. What lives in `src/` is only
the _tests_ (`src/test/doc-site-*.test.ts`) and one line of `SAMPLE_RELPATHS` for the
golden-emission suite.

## The pipeline at a glance

```
target repo
     │
     ▼
 Phase 1  detect ............ 7 read-only, network-free probes  →  detected-values map
     │                        + assumption records (ASSUME-*)        (detect.md)
     ▼
 Phase 2  interview ......... 8 params, each seeded from a probe   →  token values
     │                        (detection improves defaults, never gates)  (interview.md)
     ▼
 Phase 3  component-select .. resolve the selection record:
     │                        { contentMode, diagrams, deploy[], driftGuard, monorepo }
     ▼
 Phase 4  emit ............. per SELECTED group: read .tmpl → substitute {{TOKEN}} →
     │                        write → record sha256 in .doc-site-scaffold.json
     │                        (on re-run: EMIT / REGENERATE / SKIP_FLAG / PRESERVE)
     ▼
 Phase 5  setup-docs ........ run emitted setup-docs.sh (symlink/mixed only)
     │                        materializes manifest-driven content symlinks
     ▼
 Phase 6  build smoke ....... install + (diagram prebuild) + astro build
     │                        REQUIRE green → OK ; any nonzero → BUILD_RED (never masked)
     ▼
 Phase 7  next steps ........ run/preview/deploy guidance + every assumption + RERUN_SKIPs
```

## Phase 1 — detection (best-effort, never a gate)

Seven probes run read-only and network-free against the target repo (`detect.md`):

| #   | Probe                  | Seeds                                  | Fallback (assumption code)                  |
| --- | ---------------------- | -------------------------------------- | ------------------------------------------- |
| 1   | monorepo vs single     | `monorepo`, `{{DOCS_PKG_DIR}}` default | single (`ASSUME-MONOREPO-SINGLE`)           |
| 2   | package manager        | `{{PKG_MANAGER}}`                      | `npm` (`ASSUME-PKGMGR-NPM`)                 |
| 3   | runtime (Bun/Node)     | `{{RUNTIME}}`                          | `node` (`ASSUME-RUNTIME-NODE`)              |
| 4   | existing docs markdown | `pages[]`, default `contentMode`       | none → `native` (`ASSUME-NO-DOCS`)          |
| 5   | existing CI            | GH-Pages workflow strategy             | fresh workflow (`ASSUME-NO-CI`)             |
| 6   | default branch         | `{{DEFAULT_BRANCH}}`                   | `main`, after asking (`ASSUME-BRANCH-MAIN`) |
| 7   | repo slug / remote     | `{{REPO_SLUG}}`, `{{GITHUB_URL}}`      | ask (`ASSUME-SLUG-ASKED`)                   |

The **load-bearing principle**: detection ambiguity is _never_ a hard-fail. Every
unresolved signal degrades to a documented default plus one assumption record, and
each record reaches the user twice — at interview time (as a confirmable default) and
in the Phase 7 summary (`REQ-USE-02`). The only legitimate hard-fail is
`HARD_FAIL_IMPOSSIBLE` — no writable target tree.

## Phase 2-3 — interview and the selection record

The interview is **conversational** — exact phrasing is the agent's choice (out of
scope for byte-identity); what's fixed is the 8-parameter set, each parameter's
detection-seeded default, and the token/field it fills (`interview.md`). Because every
parameter has a non-detection default, zero detection signals still yield a complete
token set (`REQ-INT-02`).

Phases 2-3 produce two artifacts that drive everything downstream:

1. **A full token map** — values for all 17 canonical tokens (`api-reference.md`).
2. **The component-selection record** — the single structure that gates emission:

   ```jsonc
   { "contentMode": "symlink" | "native" | "mixed",
     "diagrams": false, "deploy": [], "driftGuard": false, "monorepo": false }
   ```

   Optional components default to declined. When the user declines everything and
   picks `native`, the record triggers the **decline-all invariant** — core only.

## Phase 4 — the emission model

This is the heart of the feature. For each **selected** template group, the agent:

1. reads each `.tmpl` asset (byte-identical, shipped under `references/templates/`),
2. globally replaces every `{{TOKEN}}` with its resolved value,
3. strips `.tmpl` and writes to the target path the component doc specifies (non-`.tmpl`
   assets like `favicon.svg` are copied verbatim),
4. records the sha256 of the **exact bytes written** in `.doc-site-scaffold.json`.

Two properties make the output a pure function of the answers:

- **No in-template logic.** Where behavior differs by toolchain (Bun+pnpm vs Node+npm),
  the template ships _named fragments_ and the agent _selects_ one — it never evaluates
  a conditional inside the template. This keeps substitution mechanical.
- **Derived tokens are computed, not asked.** `{{DOCS_PKG_DIR_TO_ROOT}}` is one `..`
  per `{{DOCS_PKG_DIR}}` segment; `{{SYMLINK_PAGE_LINES}}` expands from the manifest's
  `source: symlink` pages. Both are deterministic.

### Template groups and their gates

| Group                 | Emitted when                     | Produces                                                                                                                                                                                                 |
| --------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`               | always                           | `astro.config.mjs`, `content.config.ts`, `package.json`, `tsconfig.json`, `custom.css`, `index.mdx`, a starter page, `favicon.svg`; plus `docs.manifest.json` + `docs.manifest.schema.json` at repo root |
| `symlink/`            | `contentMode ∈ {symlink, mixed}` | `setup-docs.sh` + `predev`/`prebuild` wiring                                                                                                                                                             |
| `diagrams/`           | `diagrams: true`                 | vendored `scripts/diagram-render.mjs`, prebuild snippet, starter `DiagramSpec`                                                                                                                           |
| `deploy/github-pages` | `"github-pages" ∈ deploy`        | `.github/workflows/docs.yml`                                                                                                                                                                             |
| `deploy/vercel`       | `"vercel" ∈ deploy`              | `vercel.json` (repo root)                                                                                                                                                                                |
| `deploy/static`       | `"static-netlify" ∈ deploy`      | `netlify.toml` (repo root)                                                                                                                                                                               |
| `monorepo/`           | `monorepo: true`                 | workspace membership + `dev:docs`/`build:docs` passthroughs (merged into user files)                                                                                                                     |
| `drift-guard/`        | `driftGuard: true`               | `check-docs.mjs` + `docs:check` script (+ optional CI step)                                                                                                                                              |

The **decline-all invariant** (`00 §5`) is what makes this safe: nothing outside a
group references it, so omitting a group leaves no dangling hook, config, or import.
This is asserted directly by the decline-all scaffold-output golden fixture.

## The manifest triad — one source, cannot drift

`docs.manifest.json` lives at the **target repo root** (not inside the docs package)
so the one well-known location is stable for every consumer. Three consumers read it:

```
                    docs.manifest.json  (ordered pages[]; array order = sidebar order)
                            │
        ┌───────────────────┼────────────────────┐
        ▼                   ▼                    ▼
  sidebar derivation    the symlinker        the drift guard
  (sidebar.mjs)         (setup-docs.sh)      (check-docs.mjs)
  buildSidebar(pages)   link_file per        broken links, orphaned
  imported by           source:symlink page  links, missing frontmatter
  astro.config.mjs                           (sidebar can't drift —
  at build time                              it's build-time derived)
```

**Sidebar derivation** is a pure function of `pages`: single-segment slugs become
top-level leaves, multi-segment slugs group by their first path segment (first
occurrence fixes order; `label`/`group` optionally override the titleized text),
`unmanaged` pages are skipped, and the `index.mdx` splash is never a sidebar entry.
Crucially, **`source` is invisible to the sidebar** — a `native` and a `symlink` page
with the same slug render the identical leaf. That is what makes `mixed` mode fully
expressible through one manifest. The function lives in the vendored `sidebar.mjs`,
which `astro.config.mjs` imports and evaluates **at build time** — so the sidebar is
never materialized into a parallel array and cannot drift from the manifest (#34).

## Never-clobber re-runs

On every invocation the agent reads `.doc-site-scaffold.json` from the target root.
Absent ⇒ first scaffold (everything `EMIT`s, versions resolve to latest). Present ⇒
re-run, and each managed file the run would emit gets a per-file decision _before_
writing:

| On-disk state         | vs. recorded hash     | Action                                                  |
| --------------------- | --------------------- | ------------------------------------------------------- |
| absent                | —                     | `EMIT` (write + record)                                 |
| present               | matches               | `REGENERATE` (overwrite with same/new bytes, re-record) |
| present               | differs (user-edited) | `SKIP_FLAG` → emit a `RERUN_SKIP`, never clobber        |
| present               | no record (untracked) | `SKIP_FLAG` (conservative)                              |
| `source: native` page | never recorded        | `PRESERVE` (never in the emit set)                      |

The manifest, sidebar, and symlinks are then reconciled **in place**: an edited
manifest is skipped+flagged and its on-disk version becomes the source of truth (user
intent wins); the sidebar regenerates from it; `setup-docs.sh` re-runs idempotently.
**Version pins are never re-resolved on a re-run** — they're preserved from provenance
so an upstream bump can't sneak in. The result: an identical re-run is a no-op git diff
(modulo build caches), asserted by the double-apply golden fixture.

Emission is intentionally **non-transactional**: a failure partway through Phase 4 is
`PARTIAL_EMISSION` (no rollback). Files written before the failure are already in
provenance, so a re-run resumes cleanly — `REGENERATE`s the unedited, `EMIT`s the
missing, `SKIP_FLAG`s the edited.

## Diagrams — delegation by vendoring

The diagram component does **not** ship a renderer. It copies the sibling
`diagram-generator` skill's frozen `diagram-render.mjs` bundle at a **single uniform
rel-path** that resolves on every target because `skillRefDir()` roots both skills
under the same per-target parent:

```
../diagram-generator/scripts/diagram-render.mjs
   claude/codex/gemini → skills/diagram-generator/...
   cursor              → rules/diagram-generator/...
   copilot             → instructions/diagram-generator/...
```

Before copying anything, the agent runs the renderer's `--version` and verifies it
equals the pinned `CONTRACT_VERSION 1.0.0`. On any mismatch (wrong version, nonzero
exit, missing file) the component **aborts before its first write** — zero diagram
files, and **no embedded fallback** renderer (`CON-05`). On success it vendors the
bundle, records `diagramContract: "1.0.0"` + the copy's hash, and wires a `prebuild`
that renders each `src/diagrams/*.json` spec twice (light + dark) chained with `&&` so
the first nonzero renderer exit fails the build. The build smoke test (Phase 6) thus
exercises **real** diagram generation end-to-end (`REQ-DIAG-03`).

## Content plan — inbound DocPlan integration

doc-site can source its **information architecture** from a `content-architect`
**DocPlan** instead of eliciting it in the interview. A content-plan step runs after
detection (Phase 1) and before the interview: when a DocPlan is present (or the user
wants one), its `grouping` + `documents` become the manifest `pages[]`, and each entry
seeds a mode-pure native stub from `content-architect`'s per-mode templates.

The seam needs a small documented adapter because the two contracts differ in one
load-bearing way: `buildSidebar()` derives sidebar groups **implicitly** from each slug's
first path segment, whereas a DocPlan `grouping` is an **explicit** ordered section list.
The adapter normalizes every document slug in a section to a shared section-derived first
segment (`slugify(section.title)`) and sets the `group` label override to the exact
section title, so the emitted sidebar reproduces the plan's groups and order exactly. Home
links retarget to the first planned page and the default `guides/setup` seed is suppressed,
so `pages[]` is a faithful image of the plan. The full mapping — slug normalization,
collision handling, and the never-clobber rules — is in
[`skills/doc-site/references/content-plan.md`](../../../skills/doc-site/references/content-plan.md).
This is an inbound integration (doc-site consumes the plan); it mirrors the outbound
diagram delegation above in reusing a sibling skill by fixed relative path rather than
duplicating it.

## Deploy — one env contract, many targets

All three deploy targets share the same mechanism: they set two build-env vars,
`SITE` and `BASE_PATH`, that the core `astro.config.mjs` reads via `process.env`. The
**only** per-target difference is those two values:

- **GitHub Pages** — project subpath; `SITE`/`BASE_PATH` come from
  `actions/configure-pages` outputs (runtime-derived, no slug hardcode).
- **Vercel** — root-hosted; `BASE_PATH: ""`, `SITE: {{SITE_URL}}`.
- **Static / Netlify** — root by default; `BASE_PATH` set to `/subpath` only if the
  host serves a subpath.

Because the site code reads env, **adding or switching a deploy target needs zero
edits** to `astro.config.mjs` or any page (`REQ-DEPLOY-02`).

## Safety model (authoritative in `rerun.md`)

- **Write confinement** — every written path must resolve at or below the target repo
  root. A `{{DOCS_PKG_DIR}}` that climbs above root (or an absolute path) is refused,
  not silently skipped.
- **Symlink confinement** — `setup-docs.sh` creates **relative** links and, before
  linking, canonicalizes each `from` and refuses any that escapes the repo
  (`assert_inside_repo`). The `images/` directory link uses `ln -sfn` (no-dereference).
- **No external transmission** — detection reads only local files; the _only_ network
  use is `npm view` version resolution and dependency install, which send package
  _names_, never repo contents (`REQ-SEC-01..03`).

## How it integrates with this repo

The feature is purely additive (`09-integration-and-emission.md`):

- **Registration** — one `tools.manifest.json` entry
  (`{ name:"doc-site", type:"skill", source:"skills/doc-site", description }`),
  mirroring `docs-helper` / `diagram-generator`, with `targets` omitted so it emits to
  all five.
- **Emission** — `bun run build` (the `agent-agnostic-scaffold` emitter, unchanged)
  copies the skill verbatim into `adapters/<target>/…`, with only the per-target SKILL
  filename transform differing. The drift gate (`bun run build:check`) keeps the
  committed adapters byte-identical to a fresh emit.
- **No `src/` emitter changes** — the only non-test source delta is five
  `SAMPLE_RELPATHS` rows in `src/test/golden.shared.ts` for the golden-emission suite.

## In-repo verification vs. target-repo verification

A deliberate split (`10-testing-strategy.md`):

- **In `agent-docs` CI** — token-coverage (all 17 tokens used, none undefined),
  schema-fixture validation (the manifest schema accepts/rejects fixtures via ajv),
  golden emission to all 5 targets, and scaffold-output golden fixtures (including the
  decline-all and double-apply invariants). These never run the emitted Astro build.
- **In the target repo** — the Phase 6 build smoke test (`REQ-VERIFY-01`). It installs
  real dependencies and runs the real Astro build (plus real diagram prebuild if
  selected), which is out of scope for this repo's CI.

## Further reading

- [README](./README.md) — overview, quick start, when (not) to use it
- [API Reference](./api-reference.md) — the 17 tokens, the manifest/PageEntry contract and schema rules, runtime-script exit codes, the provenance shape, and the deploy env contract
