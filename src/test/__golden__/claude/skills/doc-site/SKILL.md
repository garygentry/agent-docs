---
# GENERATED — DO NOT EDIT. Source: skills/doc-site/SKILL.md. Regenerate: bun run build
name: doc-site
description: Scaffolds an Astro 5/6 + Starlight OR a Mintlify documentation site into a target repo from an agent-driven interview. Use when the user wants to add a docs site, set up Starlight/Astro or Mintlify documentation, wire a manifest-driven sidebar / docs.json navigation and content symlinks, or add docs deploy/diagram/drift-guard tooling to a project.
argument-hint: "[target repo path]"
metadata:
  argument-hint: "[target repo path]"
  allowed-tools: Read, Edit, Write, Bash
---

# doc-site

Scaffold a canon-faithful documentation site into a target repo, in one of two
**renderers** — **Astro 5/6 + Starlight** (default) or **Mintlify** (or **both** from one
shared content source). You drive a short interview, then mechanically emit a set of
component-gated template assets: you never author plumbing file content — you read each
`.tmpl` asset, substitute every token placeholder (table below), and write the result.
Because substitution is pure string replacement over byte-identical `.tmpl` assets, the
emitted file set is a pure function of the interview answers (REQ-PORT-02).

**The renderer is chosen first (interview question 0) and forks the back half of the
pipeline.** The front half — detect, DocPlan consumption, the identity interview, safety /
write-confinement, provenance / re-run, and the content-sourcing symlink engine — is
renderer-neutral and shared. Emit (config/nav/theme), verify, deploy, and diagrams fork by
renderer: Starlight uses `references/*` + `templates/core/**`; Mintlify uses
`references/mintlify/*` + `templates/mintlify/**`. Everything below defaults to Starlight
unless the renderer is `mintlify` or `both`.

The skill is **additive and safe**: it writes only inside the target repo, refuses
symlink sources that escape the repo root, and never transmits repo data externally
(network use is limited to version resolution and dependency install).

## Reference docs (pull in as needed, per phase)

These ride verbatim under `references/`; read the one for the phase/component you are
working on rather than loading everything up front.

- **`references/detect.md`** — Phase 1 detection probes + graceful-degradation table.
- **`references/content-plan.md`** — optional content-plan step: consume a `content-architect`
  **DocPlan** to drive the sidebar + mode-pure page stubs instead of guessing the IA.
- **`references/interview.md`** — Phase 2 interview parameters + detection-seeded defaults.
- **`references/core.md`**, **`references/manifest-schema.md`** — core scaffold emit +
  `docs.manifest.json` contract and the `unmanaged` escape hatch.
- **`references/symlink.md`** — `setup-docs.sh` symlink/mixed layer.
- **`references/diagrams.md`** — optional diagram component (vendored renderer + prebuild).
- **`references/deploy-github-pages.md`**, **`references/deploy-vercel.md`**,
  **`references/deploy-static-netlify.md`** — deploy wiring per target.
- **`references/monorepo.md`** — monorepo workspace + root-script merge semantics.
- **`references/drift-guard.md`** — optional `check-docs.mjs` drift guard.
- **`references/rerun.md`** — provenance manifest, re-run/never-clobber policy,
  version-pin policy, safety policy, and the build smoke-test gate.
- **`references/docs.manifest.schema.json`** — the static manifest schema shipped into the target.

**Mintlify renderer** (read these only when `renderer ∈ {mintlify, both}`):

- **`references/mintlify/overview.md`** — how the Mintlify emit forks the phases; the
  `templates/mintlify/**` group inventory and destinations.
- **`references/mintlify/docplan-adapter.md`** — DocPlan → `docs.json` `navigation` (the
  Mintlify analogue of `content-plan.md`; scope/audiences → tabs, OpenAPI → api tab).
- **`references/mintlify/docs-json.md`** — the `docs.json` contract (theme, colors, nav model).
- **`references/mintlify/content-sourcing.md`** — symlink/native/mixed into the Mintlify content
  root, and the `both`-mode shared-`content/` single-source layout.
- **`references/mintlify/verify.md`** — `mint validate` + `mint broken-links` (replaces the Astro
  build smoke test and `check-docs.mjs`); `MINT_CLI_MISSING` handling.
- **`references/mintlify/deploy.md`** — Mintlify cloud git-connect guidance + `mint export` static.
- **`references/mintlify/diagrams.md`** — native Mermaid (default) vs SVG-embed.
- **`references/mintlify/api-docs.md`** — OpenAPI-driven API tab (Mintlify-unique).

## Phased procedure

### Phase 1 — detect (`references/detect.md`)

Run network-free, read-only probes against the target repo: monorepo-vs-single,
package manager, runtime, existing docs, existing CI, default branch, and repo slug.
Detection is **best-effort, never a hard prerequisite** — every missing signal yields
a fallback default plus an assumption record (`00 §6.2`). The only legitimate
hard-fail is `HARD_FAIL_IMPOSSIBLE` (no writable tree).

### Phase 1.5 — content-plan (optional; `references/content-plan.md`)

If a **DocPlan** exists (`{{DOCS_PKG_DIR}}/docplan.json`, `docs/docplan.json`, or repo-root
`docplan.json`) — or the user wants a planned site — source the information architecture
from it instead of guessing during the interview. Validate the DocPlan against its shipped
`docplan.schema.json`, then translate `grouping` + `documents` into `docs.manifest.json`
`pages[]` via the adapter in `references/content-plan.md`: each `grouping` section becomes a
sidebar group (slug-first-segment normalized to the section), each `DocPlanEntry` a
mode-pure native page stub seeded from `content-architect`'s `references/templates/<type>.md`,
with home links retargeted to the first planned page. When no DocPlan is present and the user
does not want one, skip this step entirely and interview as usual. To author a DocPlan from
scratch, invoke the sibling **`content-architect`** skill first.

### Phase 2 — interview (`references/interview.md`)

Ask **question 0 (renderer)** first — `starlight` (default) | `mintlify` | `both`, seeded
from Phase 1 Probe 8 — then the minimum parameter set (site title/description, social links,
content-sourcing mode, markdown→sidebar-slug mapping, deploy targets, accent colors,
docs-package location), seeding each default from Phase 1. The renderer answer gates which
questions apply (Starlight-only: title-frontmatter remediation, deploy targets;
Mintlify-only: named theme, primary color, api-docs, scope tabs — `references/interview.md`).
This fills the substitution table. Optional components (diagrams, deploy targets, drift guard)
default to **declined**.

### Phase 3 — component-select (`00 §5`)

Resolve the component-selection record:

```jsonc
{ "renderer": "starlight"|"mintlify"|"both", "contentMode": "symlink"|"native"|"mixed",
  "diagrams": false, "deploy": [], "driftGuard": false, "monorepo": false,
  "mintTheme": "mint", "apiDocs": false, "scopeTabs": false }
```

This record alone decides which template groups emit. Declining a component emits
**zero** of its files (the decline-all invariant). The **`renderer`** field selects the
container group first:

- `renderer=starlight` → `core/` always; `symlink/` when `contentMode ∈ {symlink, mixed}`;
  `diagrams/` when `diagrams`; `deploy/*` per `deploy[]`; `drift-guard/` when `driftGuard`;
  `monorepo/` when `monorepo`.
- `renderer=mintlify` → `mintlify/` always (in place of `core/`); `symlink/` (retargeted to the
  Mintlify content root) when `contentMode ∈ {symlink, mixed}`; the Mintlify diagram/verify/deploy
  paths per `references/mintlify/*`. The Starlight-only groups (`core/`, `deploy/*`) are **not**
  emitted.
- `renderer=both` → emit **both** container groups over one shared content source
  (`references/mintlify/content-sourcing.md`).

### Phase 4 — emit (Starlight: `references/core.md`, `symlink.md`, `diagrams.md`, `deploy-*.md`, `monorepo.md`, `drift-guard.md`; Mintlify: `references/mintlify/*`)

For each selected template group: read each `.tmpl`, globally replace every
token placeholder with its resolved value, strip the `.tmpl` extension, and write to the
target path the component doc specifies (copy non-`.tmpl` assets verbatim). After
writing each **managed plumbing** file, record its sha256 in `.doc-site-scaffold.json`
(`references/rerun.md`); `source: native` authored pages are never recorded. On a
re-run, honor the never-clobber decision table (EMIT / REGENERATE / SKIP_FLAG /
PRESERVE).

**Renderer branch.** For `renderer=starlight`, emit `templates/core/**` and derive the
Starlight sidebar from `docs.manifest.json` (`references/core.md`). For `renderer=mintlify`,
emit `templates/mintlify/**` and inject the adapter-built `navigation` into `docs.json`
(`references/mintlify/docplan-adapter.md`, `docs-json.md`) — `docs.json` is managed-but-merged
like `docs.manifest.json`. For `renderer=both`, do both over the shared `content/` source. The
provenance/never-clobber machinery is identical across renderers.

### Phase 5 — run setup-docs (`references/symlink.md`) — symlink/mixed only

When `contentMode ∈ {symlink, mixed}`, run the emitted `setup-docs.sh` to materialize
the content symlinks (and the `images/` link). Skip entirely in native mode.

### Phase 6 — build smoke test (Starlight: `references/rerun.md`; Mintlify: `references/mintlify/verify.md`; REQ-VERIFY-01)

**Starlight:** install deps, then run the emitted build (after setup-docs and any diagram
prebuild). **Require green:** any nonzero exit is `BUILD_RED` — report the failed step and
remediation and **never report success on red**. A failure mid-emission is
`PARTIAL_EMISSION`: no rollback, flag the partial state and the failed step.

**Mintlify:** there is no Astro build — verify via the `mint` CLI
(`references/mintlify/verify.md`): `mint validate` (strict; nonzero = `VALIDATE_RED`, the
`BUILD_RED` analogue) then `mint broken-links`. If `mint` is unavailable, offer to install it
or skip with a surfaced `MINT_CLI_MISSING` assumption — **never silently report success**. For
`renderer=both`, run the Starlight build smoke test _and_ the Mintlify `mint` checks over the
shared content.

**When a subpath deploy target is selected** (GitHub Pages **project** Pages →
`BASE_PATH="/<repo>/"`), the root build above does not exercise base-path linking, so
add a **base-path build + link crawl** — it catches base-unsafe links the drift guard
can't see (frontmatter or otherwise) at the layer the site is actually served from. See
`references/rerun.md` ("base-path smoke crawl") for the exact recipe; a stray/404 link
is `BUILD_RED`.

### Phase 7 — next steps (`references/rerun.md`; REQ-VERIFY-03)

Print run/preview/deploy guidance and the collected assumption records so the user
can see every degraded default that was applied.

## Substitution table (the SKILL-side mirror of `00 §4.1`)

This is the single place tokens are documented for the agent. Tokens are **partitioned by
renderer** into three sets: **shared** (used by both containers), **Starlight-only** (used only
under `templates/core/**` and the Starlight deploy/diagram/monorepo groups), and
**Mintlify-only** (used only under `templates/mintlify/**`). The token-coverage test (`10`) is
partitioned to match: every token used under `templates/core/**` must appear in the shared or
Starlight-only set, every token under `templates/mintlify/**` in the shared or Mintlify-only
set, and vice-versa. No token appears in a template group outside its set.

The table below is the **Starlight set** (shared + Starlight-only) — the historical 23
canonical tokens, unchanged. The **Mintlify-only** tokens follow in _Mintlify token set_ below.

The last four are **derived toolchain tokens**: pure functions of `{{RUNTIME}}`
and `{{PKG_MANAGER}}` that decouple the two axes so the CI/deploy fragments never
hardcode a coupled Bun+pnpm / Node+npm pair (see _Derived toolchain tokens_ below).

| Token                      | Source                                                                   | Default                                        |
| -------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------- |
| `{{SITE_TITLE}}`           | interview                                                                | repo name (titlecased)                         |
| `{{SITE_TITLE_SLUG}}`      | **derived** (slugified `{{SITE_TITLE}}`: lowercase, spaces→`-`)          | derived                                        |
| `{{SITE_DESC}}`            | interview                                                                | `Documentation for <title>`                    |
| `{{SITE_URL}}`             | interview / deploy target                                                | `""` (env-driven at build)                     |
| `{{BASE_PATH}}`            | deploy target (GH Pages subpath vs root)                                 | `""`                                           |
| `{{REPO_SLUG}}`            | detection (`git remote`) / interview                                     | ask                                            |
| `{{GITHUB_URL}}`           | derived from `{{REPO_SLUG}}`                                             | `""`                                           |
| `{{PKG_MANAGER}}`          | detection (lockfile / `packageManager`)                                  | `npm`                                          |
| `{{RUNTIME}}`              | detection (`bun.lock` / `engines.node`)                                  | `node`                                         |
| `{{DOCS_PKG_DIR}}`         | interview                                                                | `docs/` (single) / `packages/docs/` (monorepo) |
| `{{IMAGES_SRC_DIR}}`       | interview / detection                                                    | `docs/images`                                  |
| `{{ACCENT_LIGHT}}`         | interview                                                                | canon default light accent                     |
| `{{ACCENT_DARK}}`          | interview                                                                | canon default dark accent                      |
| `{{DEFAULT_BRANCH}}`       | detection (`git symbolic-ref`)                                           | `main`                                         |
| `{{ASTRO_VERSION}}`        | resolution (latest @ first scaffold; pin on re-run)                      | latest                                         |
| `{{STARLIGHT_VERSION}}`    | resolution                                                               | latest                                         |
| `{{DOCS_PKG_DIR_TO_ROOT}}` | **derived** (one `..` per `{{DOCS_PKG_DIR}}` segment)                    | derived                                        |
| `{{SYMLINK_PAGE_LINES}}`   | **derived/generated** (one link line per `source: symlink` page)         | generated                                      |
| `{{CI_SETUP_ACTION}}`      | **derived** from `{{RUNTIME}}` (CI runtime setup action)                 | `actions/setup-node@v4`                        |
| `{{INSTALL_CMD}}`          | **derived** from `{{PKG_MANAGER}}` (frozen-lockfile install)             | `npm ci`                                       |
| `{{RUN_PREFIX}}`           | **derived** from `{{PKG_MANAGER}}` (run-a-script prefix)                 | `npm run`                                      |
| `{{WORKSPACE_BUILD}}`      | **derived** from `{{PKG_MANAGER}}`+`{{DOCS_PKG_DIR}}` (build invocation) | `npm run build --workspace <dir>`              |

**Direct vs. derived.** Most tokens are direct interview/detection values.
`{{DOCS_PKG_DIR_TO_ROOT}}` is a pure function of `{{DOCS_PKG_DIR}}` (count path
segments → that many `..`), and `{{SYMLINK_PAGE_LINES}}` expands to a generated block
from the manifest's `source: symlink` pages (`references/symlink.md`). After
substitution, **no literal `{{…}}` may survive** in any emitted file.

### Derived toolchain tokens

`{{CI_SETUP_ACTION}}`, `{{INSTALL_CMD}}`, `{{RUN_PREFIX}}`, and `{{WORKSPACE_BUILD}}`
are **derived** — pure functions of the two orthogonal toolchain axes
(`{{RUNTIME}}` and `{{PKG_MANAGER}}`), never asked in the interview. They let the
CI/deploy fragments stay a single tokenized form instead of shipping coupled
Bun+pnpm / Node+npm variants. The agent computes them from detection before
substitution. `npm`, `pnpm`, `yarn`, and `bun` are all supported; the canon
fixtures exercise `npm` and `pnpm` (the `yarn`/`bun` rows are supported-but-unfixtured).

| `{{RUNTIME}}` | `{{CI_SETUP_ACTION}}`   |
| ------------- | ----------------------- |
| `node`        | `actions/setup-node@v4` |
| `bun`         | `oven-sh/setup-bun@v2`  |

| `{{PKG_MANAGER}}` | `{{INSTALL_CMD}}`                | `{{RUN_PREFIX}}` | `{{WORKSPACE_BUILD}}`                      |
| ----------------- | -------------------------------- | ---------------- | ------------------------------------------ |
| `npm`             | `npm ci`                         | `npm run`        | `npm run build --workspace <DOCS_PKG_DIR>` |
| `pnpm`            | `pnpm install --frozen-lockfile` | `pnpm run`       | `pnpm --filter ./<DOCS_PKG_DIR> build`     |
| `yarn`            | `yarn install --immutable`       | `yarn run`       | `yarn workspace <DOCS_PKG_DIR> build`      |
| `bun`             | `bun install`                    | `bun run`        | `bun run --filter ./<DOCS_PKG_DIR> build`  |

`<DOCS_PKG_DIR>` is `{{DOCS_PKG_DIR}}` already substituted (the derived token's
value carries the resolved path). For pnpm, the CI workflow also injects a
`pnpm/action-setup@v4` step (pnpm needs its own setup regardless of runtime);
npm/yarn/bun need no extra package-manager setup step.

## Mintlify token set (used only under `templates/mintlify/**`)

Emitted only when `renderer ∈ {mintlify, both}`. These are **in addition to** the shared
tokens (`{{SITE_TITLE}}`, `{{SITE_TITLE_SLUG}}`, `{{SITE_DESC}}`, `{{GITHUB_URL}}`,
`{{REPO_SLUG}}`, `{{DEFAULT_BRANCH}}`, `{{DOCS_PKG_DIR}}`, `{{IMAGES_SRC_DIR}}`,
`{{PKG_MANAGER}}`, `{{RUNTIME}}`), which the Mintlify templates reuse verbatim. The
Starlight-only tokens (accents, Astro/Starlight versions, `{{SITE_URL}}`, `{{BASE_PATH}}`,
`{{DOCS_PKG_DIR_TO_ROOT}}`, the CI/deploy derived tokens) are **never** present in a
Mintlify template.

| Token                  | Source                                                                                                                                      | Default                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `{{MINT_THEME}}`       | interview M1                                                                                                                                | `mint`                      |
| `{{MINT_PRIMARY}}`     | interview M2 (derived from the accent answer if not given)                                                                                  | canon default primary (hex) |
| `{{MINT_COLOR_LIGHT}}` | **derived** from `{{MINT_PRIMARY}}` (light-tint)                                                                                            | derived                     |
| `{{MINT_COLOR_DARK}}`  | **derived** from `{{MINT_PRIMARY}}` (dark-tint)                                                                                             | derived                     |
| `{{MINT_NAVIGATION}}`  | **generated** by the DocPlan→nav adapter (`references/mintlify/docplan-adapter.md`) — the `navigation` JSON block injected into `docs.json` | generated                   |

For **single-renderer** Mintlify the content root is the shared `{{DOCS_PKG_DIR}}` (no extra
token). The `both`-mode shared-content directory is introduced in
`references/mintlify/content-sourcing.md` (Phase E) and does not add a template token.

`{{MINT_NAVIGATION}}` is the Mintlify analogue of Starlight's build-time
`buildSidebar(manifest.pages)`, except Mintlify has no JS build hook, so the block is
materialized into `docs.json` at **emit time** and reconciled (managed-but-merged) on re-run.
After substitution, **no literal `{{…}}` may survive** in any emitted Mintlify file.
