# Mintlify content sourcing (agent reference)

How page bodies reach a Mintlify site under each `contentMode`, and — for `renderer=both` — the
**single-source** layout that keeps content from being duplicated across the two containers.

## Single-renderer Mintlify

The Mintlify project **is** the content root (`{{DOCS_PKG_DIR}}`, default `docs/`). `docs.json`
and the `.mdx` pages live there together; there is no build/content split.

| `contentMode` | Where page bodies come from                                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `native`      | Authored stubs written directly under `{{DOCS_PKG_DIR}}/` (DocPlan-seeded, `docplan-adapter.md §4`, or the default `guides/setup`). |
| `symlink`     | Repo markdown symlinked into `{{DOCS_PKG_DIR}}/` at each nav path, via the shared `setup-docs.sh`.                                  |
| `mixed`       | Per-page: some symlinked, some authored.                                                                                            |

The symlink layer is the **same engine** as Starlight's (`../symlink.md`) — the only change is
the **target content dir**: Starlight links into `src/content/docs/`, Mintlify links into the
project root (`{{DOCS_PKG_DIR}}/`). The confinement rules are unchanged (`rerun.md §5.2`): every
`from` must resolve inside the repo root; links are relative; `-n`/no-dereference for directory
links. Mintlify needs **no** `.md`→route fallback and **no** `title:` load-fail remediation
(that is a Starlight `docsSchema()` artifact) — a missing `title` is a `mint validate` warning,
surfaced but not build-breaking.

## `both` — one source, two containers (the anti-duplication layout)

Content lives **once**; each container references it. Recommended layout:

```
docs/
  content/                 # SINGLE SOURCE OF TRUTH — portable .md (title+description only)
    guides/setup.md
  starlight/               # Starlight container (astro.config, docs.manifest.json, sidebar.mjs)
    src/content/docs/  ->  symlinks into ../../content
  mintlify/                # Mintlify container (docs.json, index.mdx landing)
    guides/setup.md    ->  symlinks into ../content
```

- The **DocPlan is authored once** and drives **both** adapters — `docs.manifest.json`
  (`../content-plan.md`) _and_ `docs.json` (`docplan-adapter.md`). Config is generated per
  renderer; it is not duplicated content.
- Page bodies live once under `docs/content/`; a single `setup-docs.sh` run fans them out into
  both containers (one `link_file` block per active renderer target).
- **Portability constraint (enforced by the Phase 6 lint, `verify.md §4`):** shared pages under
  `content/` use only the portable frontmatter subset (`title`, `description`) and CommonMark —
  **no renderer-specific MDX components** (Starlight `<Card>` renders only in Starlight; Mintlify
  `<Steps>` only in Mintlify). Component-rich pages (each container's home/landing) are the
  **only** per-renderer content and live inside the container dir, never in `content/`.
- `both` is the explicit power path; single-renderer is the default. Prefer it only when the user
  genuinely wants two published sites from one corpus.

### Mintlify-cloud symlink caveat

Git preserves symlinks, and `mint dev` / `mint export` follow them locally. **Verify** the
hosted Mintlify build resolves git symlinks before relying on the layout above. If it does not,
**invert** the `both` layout: make the shared source Mintlify's **real** files (Mintlify is
content-first — files + `docs.json`, no build dir) and have the **Starlight** container symlink
_from_ the Mintlify content dir. Either way the source exists once.
