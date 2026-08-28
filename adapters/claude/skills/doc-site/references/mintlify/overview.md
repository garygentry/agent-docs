# Mintlify renderer — emit overview (agent reference)

Read this when `renderer ∈ {mintlify, both}`. It is the Mintlify analogue of `core.md`: it
says **what the Mintlify container emits, where, and how the phases fork.** The shared front
half (detect, DocPlan discovery, identity interview, safety/confinement, provenance/re-run) is
unchanged — see the top-level references. Only emit, verify, deploy, and diagrams fork here.

## What Mintlify is (the one-paragraph model)

A Mintlify site is a **single `docs.json` config + a tree of `.md`/`.mdx` pages**. There is no
build step and no site dependencies — the global `mint` CLI previews (`mint dev`), validates
(`mint validate`), and checks links (`mint broken-links`); deployment is Mintlify's hosted
cloud (git-connected) or a `mint export` static zip. Navigation is **explicit** in `docs.json`
(`navigation.groups`/`tabs`/…), so — unlike Starlight's build-time `buildSidebar` — the nav is
materialized into `docs.json` at emit time.

## Template group: `templates/mintlify/**` → destinations

Emitted into the docs package directory (`{{DOCS_PKG_DIR}}/`, default `docs/`), which for a
single-renderer Mintlify site **is** the content root:

| Template asset      | Target path (under `{{DOCS_PKG_DIR}}/`)                                | Managed?                                      |
| ------------------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| `docs.json.tmpl`    | `docs.json`                                                            | managed-but-merged (nav reconciled on re-run) |
| `index.mdx.tmpl`    | `index.mdx` (home landing)                                             | managed (hash-tracked)                        |
| `package.json.tmpl` | `package.json` (thin `mint` script wrapper)                            | managed (hash-tracked)                        |
| `.gitignore.tmpl`   | `.gitignore`                                                           | managed (hash-tracked)                        |
| `favicon.svg`       | `public/favicon.svg` (verbatim; `docs.json` references `/favicon.svg`) | managed (verbatim)                            |

Page bodies (`guides/setup.mdx`, DocPlan stubs, …) are **authored content**, `source: native`,
and are **never** hash-tracked — the user owns them after first write (`rerun.md §2`). This is
the same never-clobber contract Starlight uses; only the container files above are managed.

## Phase fork (relative to `SKILL.md`)

- **Phase 3 (component-select):** `renderer=mintlify` emits `templates/mintlify/**` in place of
  `templates/core/**`; the Starlight-only groups (`core/`, `deploy/*`) do not emit. `symlink/`
  still emits when `contentMode ∈ {symlink, mixed}`, retargeted to the Mintlify content root
  (`content-sourcing.md`). Diagrams/verify/deploy use the Mintlify paths.
- **Phase 4 (emit):** substitute the Mintlify tokens (SKILL.md _Mintlify token set_). The
  `{{MINT_NAVIGATION}}` block is **generated** by the DocPlan→nav adapter (`docplan-adapter.md`)
  or, absent a DocPlan, from the interview's page mapping (`docs-json.md §navigation from the
interview`). Record each managed file's sha256 in `.doc-site-scaffold.json`, exactly as
  Starlight does. **No astro/starlight version pins** are resolved (`rerun.md` §4 is a no-op for
  Mintlify — the `mint` CLI is a global, not a repo dependency).
- **Phase 5 (setup-docs):** symlink/mixed only — run `setup-docs.sh` (retargeted content dir).
- **Phase 6 (verify):** `mint validate` + `mint broken-links` in place of the Astro build smoke
  test (`verify.md`).
- **Phase 7 (next steps):** print `mint dev` / deploy guidance (`deploy.md`) + assumption records.

## `both`

`renderer=both` emits **both** container groups over one shared content source; the layout,
symlink fan-out, and portability constraint are in `content-sourcing.md`.

## Determinism

Emit `docs.json` with a fixed key order — top level `$schema`, `theme`, `name`, `description`,
`colors`, `favicon`, `navigation`, `navbar`, `footer`; `colors` as `primary`, `light`, `dark`;
2-space indent, trailing newline — so an identical re-run is a byte-for-byte no-op (`rerun.md
§3`). `{{MINT_NAVIGATION}}` is generated deterministically from the DocPlan/interview
(`docplan-adapter.md §order`).
