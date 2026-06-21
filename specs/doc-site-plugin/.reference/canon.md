# Canon: Astro Starlight Docs Site Generator (Plugin/Skill)

## Context

The `rauf` monorepo (`packages/docs/`) contains a working, well-factored Astro
Starlight documentation site with a distinctive design goal: **the repo's
markdown is the single source of truth, and the docs site is a thin, deployable
view over it**. Specs live at the repo root (`docs/*.md`, `CONTRIBUTING.md`),
get symlinked into the Starlight content collection at build time, are augmented
with generated diagrams, and guarded against drift by a CI check.

We want to reproduce this setup for _other_ repos in a consistent way. Rather
than hand-copying files each time, the goal is a reusable **plugin or skill**
that scaffolds an equivalent site into any repo. This document captures the
canonical anatomy of the existing implementation and the decisions a generator
must make, so it can serve as the spec ("canon") for building that
plugin/skill. **We do not build the plugin/skill in this repo** — this is the
reference design only.

Decisions captured from the requester:

- **Target form:** keep the canon generic so it can back _either_ a skill or a
  plugin; defer final packaging.
- **Content sourcing:** support **both** modes — symlink existing repo docs
  (single source of truth) _and_ native author-in-site — selectable per repo.
- **Deploy targets:** cover **GitHub Pages, Vercel, and generic static/Netlify**.

## Reference Implementation (what exists today, in `packages/docs/`)

The canon is derived from these concrete files. Anyone building the
plugin/skill should treat them as the gold master.

| File                                        | Role to generalize                                                                                                                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/docs/astro.config.mjs`            | Starlight config: title/description, social links, **sidebar tree**, `customCss`, `site`/`base` from `SITE`/`BASE_PATH` env, `passthroughImageService()` (avoids the Sharp dependency).                               |
| `packages/docs/package.json`                | `@rauf/docs`; `predev`/`prebuild` hooks run diagram-gen + symlink setup; `dev`/`build`/`preview` scripts; deps pinned to `astro@^5` + `@astrojs/starlight@^0.33`.                                                     |
| `packages/docs/src/content.config.ts`       | Standard Starlight `docsLoader()` + `docsSchema()` collection.                                                                                                                                                        |
| `packages/docs/src/styles/custom.css`       | Accent-color theming only (light + dark `--sl-color-accent*`). Minimal, no component overrides.                                                                                                                       |
| `packages/docs/src/content/docs/**`         | Mix of **authored** pages (`index.mdx` splash, getting-started/guides/reference) and **symlinked** spec pages.                                                                                                        |
| `packages/docs/public/favicon.svg`          | Static asset.                                                                                                                                                                                                         |
| `scripts/setup-docs.sh`                     | **Idempotent symlinker.** Relative-path symlinks from the content dir to repo-root docs + a symlinked `images/` dir; clears `.astro` cache. Comments note it must stay in sync with the sidebar and the diagram list. |
| `scripts/generate-diagrams.ts`              | Generates theme-aware SVG diagrams into `docs/images/`, symlinked into content.                                                                                                                                       |
| `scripts/check-docs.ts`                     | **Anti-drift gate.** Walks docs (following symlinks), flags stale grammar/branding/version pins, and diffs the CLI command registry against the CLI spec. Wired into `pnpm gate`.                                     |
| `.github/workflows/docs.yml`                | GitHub Pages deploy: Bun + pnpm, `pnpm --filter @rauf/docs build` with `SITE`/`BASE_PATH`, upload-pages-artifact → deploy-pages. Triggers on docs/spec/workflow paths.                                                |
| root `package.json` / `pnpm-workspace.yaml` | `dev:docs`/`build:docs` passthroughs; workspace membership.                                                                                                                                                           |

### The five reusable mechanics worth preserving

1. **Env-driven `site`/`base`** so the same build works on GitHub Pages
   (subpath) and root-hosted static/Vercel without code changes.
2. **`passthroughImageService()`** — keeps the install lightweight (no Sharp)
   when diagrams are already SVG.
3. **Symlink content bridge** — `setup-docs.sh` keeps repo markdown as the
   source of truth; the same relative `images/...` paths resolve both on GitHub
   and in Starlight. Note the `-n`/`--no-dereference` care for the `images/`
   _directory_ symlink, and the `.astro` cache clear after relinking.
4. **Generated diagrams as build inputs** — diagrams are regenerated every
   `prebuild`, never hand-edited in the site.
5. **Drift guard in CI** — `check-docs.ts` is the piece that keeps a
   thin-view docs site honest over time; the canon should make an
   equivalent (even if the specific rules are project-specific).

## The Generator's Job (what the plugin/skill must produce)

Given a target repo, the generator scaffolds a docs package equivalent to the
above. The work decomposes into these areas; the plugin/skill is essentially a
parameterized emitter of the reference files plus a short interview to fill the
parameters.

### 1. Detect & interview

- Detect repo shape: monorepo (pnpm/npm/yarn workspaces) vs single package;
  package manager; runtime (Bun vs Node); existing `docs/` markdown; existing
  CI; default branch; repo slug/remote.
- Interview/derive parameters: **site title & description**, **social links**,
  **content-sourcing mode** (symlink vs native vs mixed), **which existing
  markdown files map to which sidebar slugs**, **deploy target(s)**, **accent
  colors / brand**, **docs package location** (`packages/docs` vs `docs-site/`).

### 2. Scaffold the Astro Starlight package

- Emit `astro.config.mjs`, `package.json`, `tsconfig.json`,
  `src/content.config.ts`, `src/styles/custom.css`, `public/favicon.svg`,
  and a starter `src/content/docs/index.mdx` splash + at least one authored
  page. Pin Astro 5 / Starlight 0.33+ (canon should record the tested
  versions and allow bumping).
- Generate the **sidebar** from the discovered/selected page mapping. Sidebar
  entries and content pages must be emitted from one shared manifest so they
  cannot drift (improvement over the current hand-kept parallel lists).

### 3. Content-sourcing layer (configurable — both modes)

- **Symlink mode:** emit a generalized `setup-docs.sh` (relative paths,
  idempotent, `--no-dereference` dir handling, `.astro` cache clear) driven by
  the page-mapping manifest, plus `predev`/`prebuild` wiring.
- **Native mode:** skip symlinks; author pages live in the site; no setup
  script needed.
- **Mixed:** symlink some (existing specs), author others. The manifest marks
  each page `source: symlink|native`.
- Single manifest (e.g. `docs.manifest.(json|ts)`) is the canonical input that
  feeds the sidebar, the symlinker, and the drift check — eliminating the
  three-places-to-keep-in-sync hazard the current repo manages by comment.

### 4. Diagrams (optional component)

- Offer a generalized `generate-diagrams` step + `passthroughImageService`
  wiring when the repo wants generated SVGs; otherwise omit and drop the
  prebuild hook. Keep it strictly optional so simple sites stay simple.

### 5. Deploy target(s)

Emit the selected one(s); all share the env-driven `site`/`base`:

- **GitHub Pages:** `.github/workflows/docs.yml` patterned on the reference
  (Bun+pnpm or Node+npm per detected toolchain; `SITE`/`BASE_PATH` from the
  Pages action; path-filtered triggers).
- **Vercel:** static output (`base` empty, `site` = production URL);
  `vercel.json`/project settings note; no base-path juggling.
- **Generic static / Netlify:** plain `astro build` to `dist/` + a
  `netlify.toml` (or documented static-host instructions); `base` configurable.

### 6. Drift guard (optional but recommended)

- Emit a generalized `check-docs`-style script and a `gate`/CI hook. Ship a
  small set of **generic** rules (broken internal links, sidebar↔manifest
  parity, orphaned symlinks, pages missing required frontmatter) rather than
  rauf-specific grammar rules. Document how a repo adds its own rules.

### 7. Idempotency & re-run

- The generator must be safe to re-run: detect an existing docs package, diff
  rather than clobber, and update the manifest/sidebar/symlinks in place — the
  same idempotency property `setup-docs.sh` already guarantees at the symlink
  level.

## Canon Deliverable (what to write when building this for real, elsewhere)

The plugin/skill repo should contain:

1. **Templates** — the reference files above, parameterized (handlebars-style
   or string-fill), organized by component (core, symlink-mode,
   diagrams, deploy/github-pages, deploy/vercel, deploy/static, drift-guard).
2. **A manifest schema** — the single source feeding sidebar + symlinker +
   drift check.
3. **An orchestration procedure** (SKILL.md if skill; command(s) if plugin):
   detect → interview → select components → emit → run `setup-docs` → run a
   build smoke test → print next steps.
4. **This canon** as the design rationale doc.

## Verification (how to validate the eventual plugin/skill)

Because we are _not_ implementing in this repo, verification here is limited to
confirming the canon faithfully reflects the working site:

- Re-read the reference files in the table above and confirm each row's "role
  to generalize" is accurate and complete.
- Sanity-check the reference site still builds as the baseline the canon
  describes: `pnpm build:docs` from the rauf root (runs diagram-gen +
  `setup-docs.sh` + `astro build`).

When the plugin/skill is later built (in its own repo), validate it by:

- Scaffolding into (a) a fresh single-package repo and (b) a monorepo, in each
  content-sourcing mode, then running the emitted build to green.
- For each deploy target, confirm the build output is correct for that host
  (GitHub Pages subpath assets resolve; Vercel/static root assets resolve).
- Run the emitted drift guard against an intentionally-broken page and confirm
  it fails; against a clean tree and confirm it passes.
- Re-run the generator on an already-scaffolded repo and confirm idempotency
  (no destructive overwrite, manifest/sidebar updated in place).
