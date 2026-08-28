# Mintlify content sourcing (agent reference)

How page bodies reach a Mintlify site under each `contentMode`, and — for `renderer=both` — the
**single-source** layout that keeps content from being duplicated across the two containers.

## Single-renderer Mintlify

The Mintlify project **is** the content root (`{{DOCS_PKG_DIR}}`, default `docs/`). `docs.json`
and the `.mdx` pages live there together; there is no build/content split.

| `contentMode` | Where page bodies come from                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `native`      | Authored stubs written directly under `{{DOCS_PKG_DIR}}/` (DocPlan-seeded, `docplan-adapter.md §4`, or the default `guides/setup`).                      |
| `symlink`     | Repo markdown symlinked into `{{DOCS_PKG_DIR}}/` at each nav path, via the emitted `setup-docs.sh` (shared symlink engine, `mintlify-symlink/` variant). |
| `mixed`       | Per-page: some symlinked, some authored.                                                                                                                 |

The symlink layer is the **same engine** as Starlight's (`../symlink.md`) — the only change is
the **target content dir**: Starlight links into `src/content/docs/`, Mintlify links into the
project root (`{{DOCS_PKG_DIR}}/`). The confinement rules are unchanged (`rerun.md §5.2`): every
`from` must resolve inside the repo root; links are relative; `-n`/no-dereference for directory
links. Mintlify needs **no** `.md`→route fallback and **no** `title:` load-fail remediation
(that is a Starlight `docsSchema()` artifact) — a missing `title` is a `mint validate` warning,
surfaced but not build-breaking.

> **Deploying to Mintlify cloud?** A `symlink` source **outside** `{{DOCS_PKG_DIR}}/` renders
> locally but 404s on the hosted git build — see _Mintlify-cloud: symlinked content must live
> inside the content root_ below. Prefer `native` (or a content root that IS the canonical
> markdown dir) for a cloud deploy.

## `both` — two containers, one source, via sequential runs (no dual-emit)

`renderer=both` is **not** a special single-run mode that emits two containers at once. It is
**two ordinary single-renderer runs into two distinct `{{DOCS_PKG_DIR}}`s**, over one shared
source. Running the skill twice is what makes the two sites coexist without clobbering — the
containers live in disjoint directories, so their emitted file sets are disjoint and each
toolchain scans only its own dir. (Two renderers in the **same** dir would collide on
`package.json`/`.gitignore`/`setup-docs.sh`; the Phase-1 guard `SAME_DIR_RENDERER_CONFLICT`
refuses that — `../detect.md` Probe 8.)

Recommended layout — the shared source is the repo's markdown, symlinked into each container:

```
docs-src/                  # SINGLE SOURCE OF TRUTH — portable .md (title+description only)
  guides/setup.md
docs/                      # Starlight run 1: astro.config, docs.manifest.json, sidebar.mjs
  src/content/docs/  ->  symlinks into ../../docs-src   (its own setup-docs.sh)
docs-mintlify/             # Mintlify run 2: docs.json, index.mdx landing
  guides/setup.md    ->  symlinks into ../docs-src        (its own setup-docs.sh)
```

- **Author once, render twice.** The DocPlan is authored once and drives **both** adapters —
  `docs.manifest.json` (`../content-plan.md`) _and_ `docs.json` (`docplan-adapter.md`). Config
  is generated per renderer; content is not duplicated. Both runs use `symlink` mode pointing
  at the same `docs-src/`, so page bodies live once and each container symlinks them in.
- **Provenance merges, never replaces.** Both runs share the repo-root
  `.doc-site-scaffold.json`; the second run keeps the first's entries/pins and unions in its own
  (`rerun.md §1.4`). Each run stays a no-op for the other's files.
- **Order-independent and incremental.** Run Starlight now and add Mintlify months later (or the
  reverse) — the later run is just a scaffold into a new dir. Neither disturbs the other.
- **Portability constraint (enforced by the Phase 6 lint, `verify.md §4`):** shared pages under
  `docs-src/` use only the portable frontmatter subset (`title`, `description`) and CommonMark —
  **no renderer-specific MDX components** (Starlight `<Card>` renders only in Starlight; Mintlify
  `<Steps>` only in Mintlify). Component-rich pages (each container's home/landing) are the
  **only** per-renderer content and live inside the container dir, never in `docs-src/`.
- `both` is the explicit power path; single-renderer is the default. Prefer it only when the user
  genuinely wants two published sites from one corpus.

### Mintlify-cloud: symlinked content must live INSIDE the content root (CONFIRMED)

The `mint` CLI — `dev`, `validate`, `broken-links`, `export` — follows symlinks **locally**,
because the whole working tree is present. Mintlify's **hosted git build does not**: the GitHub
app builds only the folder it is pointed at (the one holding `docs.json`), and a symlink whose
target is **outside** that folder resolves to nothing — the page 404s. Git preserves the symlink
correctly (mode `120000`); the target simply isn't in the build context. **This was confirmed on
a real deploy**: only the native page inside the content root rendered; every page symlinked from
a sibling `../docs-src/` (or `../../docs/**`) 404'd.

**Implication per mode — for a Mintlify _cloud_ deploy the content root must physically hold the
page files:**

- **Single-renderer `symlink`** from a source **outside** `{{DOCS_PKG_DIR}}/` works with `mint
dev`/`export` locally but **fails on the hosted build**. For cloud, either author the pages
  **natively inside the content root**, or make the content root itself the canonical home of the
  markdown (Mintlify is content-first: real `.md` + `docs.json`, no build dir) and point the app
  there — e.g. put `docs.json` in the existing `docs/` folder rather than symlinking into a
  separate `docs-site/`.
- **`both`** — the `docs-src/` → `docs-mintlify/` symlink layout shown above is **local-only** for
  the Mintlify container (its links escape `docs-mintlify/`). For a cloud deploy, **invert** it: the
  Mintlify content dir holds the **real** files and the **Starlight** container symlinks _from_
  there (Astro's build follows those local symlinks at build time). Mintlify cloud then serves
  real files; the source still exists once.

`mint export` resolves symlinks at export time, so a symlink layout **can** still be published
statically — the restriction is specific to the **git-connected hosted build**.
