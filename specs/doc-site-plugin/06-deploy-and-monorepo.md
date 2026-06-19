# 06 — Deploy Targets & Monorepo Portability

The **deploy + portability** subsystem of `doc-site-plugin`. It specifies the
component-gated deploy template groups (GitHub Pages, Vercel, generic
static/Netlify) and the monorepo-registration fragments, plus the single
environment-driven `site`/`base` mechanism that lets one build serve a hosted
subpath or a root host with **no site-code edits**.

This document covers only the **wiring** emitted around the core site: CI
workflow, host config files, workspace-manifest registration, and root
passthrough scripts. The core `astro.config.mjs` that *consumes* the
`SITE`/`BASE_PATH` env vars is owned by `03-core-site-and-manifest.md`; this
document only describes how each target *supplies* those vars at build time.

Every template asset below rides verbatim into the agent bundle and is resolved
by plain `{{TOKEN}}` substitution (`00-core-definitions.md §4`); component
gating follows the component-selection model (`00-core-definitions.md §5`) and
the template-group map (`01-architecture-layout.md §2.2`). The emitted wiring
stays faithful to the reference implementation rows in
`.reference/canon.md` (the `.github/workflows/docs.yml` row and the
`root package.json` / `pnpm-workspace.yaml` row — CON-04).

## Requirement Coverage

| REQ / decision ID | Requirement                                                         | Section          |
| ----------------- | ------------------------------------------------------------------- | ---------------- |
| REQ-DEPLOY-01     | Emit deploy wiring for any selected subset: GH Pages / Vercel / static-Netlify | §2, §3, §4, §5 |
| REQ-DEPLOY-02     | All targets share one env-driven `site`/`base`; no site-code edits  | §6               |
| REQ-CORE-02       | Env-driven `site`/`base` (supplied from the deploy side)            | §3, §4, §5, §6   |
| REQ-PORT-01       | Emitted toolchain wiring matches detected pkg manager + runtime     | §3.3, §7.2       |
| REQ-PORT-03       | Monorepo: register docs package in workspace manifest + root passthrough scripts | §7        |
| REQ-USE-01        | Each deploy target / monorepo group emitted only when selected      | §2, §7.1         |

## 1. Purpose & scope

### 1.1 What this subsystem produces

| Selection (`00 §5`)                    | Template group (`01 §2.2`)       | Emitted target-repo file(s)                        |
| -------------------------------------- | -------------------------------- | -------------------------------------------------- |
| `"github-pages" ∈ deploy`              | `deploy/github-pages/`           | `.github/workflows/docs.yml`                       |
| `"vercel" ∈ deploy`                    | `deploy/vercel/`                 | `vercel.json`                                       |
| `"static-netlify" ∈ deploy`            | `deploy/static/`                 | `netlify.toml` (+ documented static-host steps)    |
| `monorepo = true`                      | `monorepo/`                      | workspace-manifest registration + root passthrough scripts |

Each row is independent: the `deploy[]` array (`00 §5`) may select any subset,
including all three or none, and they coexist without interference (a repo can
ship both a Pages workflow and a `vercel.json`). The monorepo group is gated on
the detection-seeded `monorepo` flag, orthogonal to `deploy[]`.

### 1.2 What is explicitly out of scope here

- The `astro.config.mjs` that reads `SITE`/`BASE_PATH` — owned by
  `03-core-site-and-manifest.md`. §6 only specifies the *contract* this doc
  relies on from it.
- The docs-package `package.json` `dev`/`build`/`preview` scripts — owned by
  `03`. §7.3 adds only the **root** passthrough scripts for monorepos.
- Performing a deploy or managing hosting accounts (PRD OOS-03). The generator
  emits config; it never deploys.

### 1.3 Provenance

Each emitted file in §2–§7 is a **managed plumbing file** and its sha256 is
recorded in `.doc-site-scaffold.json` (`00-core-definitions.md §3`), making it
subject to never-clobber on re-run (`08-rerun-and-verification.md`). The
monorepo registrations in §7 are **merges into pre-existing files** and follow
the special re-run handling in §7.4.

## 2. Component gating (REQ-USE-01)

The agent emits a deploy group **iff** its key is present in the
`deploy: string[]` selection record (`00 §5`). The valid members are exactly:

```jsonc
"deploy": ["github-pages", "vercel", "static-netlify"]   // any subset, may be []
```

- `deploy = []` ⇒ no deploy file is written; the core scaffold still builds
  (this is part of the decline-all invariant, `00 §5`).
- Selecting target *X* never causes target *Y*'s files to appear, and never
  edits the core site — see §6 (REQ-DEPLOY-02).

No deploy group introduces any token beyond the canonical table
(`00-core-definitions.md §4.1`).

## 3. GitHub Pages — `deploy/github-pages/docs.yml.tmpl`

### 3.1 Target path & role

Resolved file: `.github/workflows/docs.yml` in the target repo. A GitHub Actions
workflow that builds the docs package and deploys it to **project** GitHub Pages
(served at `https://<owner>.github.io/<repo>/`, i.e. a subpath). Patterned on
the canon `.github/workflows/docs.yml` row (CON-04).

### 3.2 Tokens consumed (all from `00 §4.1`)

| Token              | Role in this template                                               |
| ------------------ | ------------------------------------------------------------------- |
| `{{DEFAULT_BRANCH}}` | Branch whose pushes trigger a deploy (e.g. `main`).               |
| `{{DOCS_PKG_DIR}}`   | Path-filter prefix + working directory for the build.            |
| `{{PKG_MANAGER}}`    | `pnpm` (Bun toolchain) or `npm` (Node toolchain) — install + build commands. |
| `{{RUNTIME}}`        | `bun` or `node` — which setup action runs.                       |
| `{{REPO_SLUG}}`      | Used to set `BASE_PATH` to `/<repo>` and `SITE` to the Pages origin. |

**Subpath base (REQ-CORE-02):** because project Pages is served from a subpath,
`BASE_PATH` MUST be `/<repo>` so Astro prefixes every asset/link with the repo
segment and assets resolve on the project Pages subpath (PRD §8 success
criterion: "GitHub Pages subpath assets resolve"). `SITE` is the Pages origin
(`https://<owner>.github.io`). Both are derived at workflow runtime from the
`actions/configure-pages` step output, so the value is never hand-edited.

### 3.3 Toolchain matching (REQ-PORT-01)

The detection layer (`02-detection-and-interview.md`) resolves exactly one of
two toolchains; the template ships in **two named fragments** (no in-template
conditionals — `00 §4`), and the agent emits the fragment matching
`{{RUNTIME}}`/`{{PKG_MANAGER}}`:

| Detected         | `{{RUNTIME}}` | `{{PKG_MANAGER}}` | Setup action            | Install        | Build invocation                        |
| ---------------- | ------------- | ----------------- | ----------------------- | -------------- | --------------------------------------- |
| Bun + pnpm       | `bun`         | `pnpm`            | `oven-sh/setup-bun@v2`  | `pnpm install --frozen-lockfile` | `pnpm --filter ./{{DOCS_PKG_DIR}} build` |
| Node + npm       | `node`        | `npm`             | `actions/setup-node@v4` | `npm ci`       | `npm run build --workspace {{DOCS_PKG_DIR}}` (monorepo) / `npm run build` in `{{DOCS_PKG_DIR}}` (single) |

The single-package vs monorepo build invocation is selected by the same
template-fragment mechanism (the agent picks the fragment line; never an
`if` in YAML).

### 3.4 The template — Bun + pnpm fragment

`deploy/github-pages/docs.yml.tmpl` (Bun+pnpm variant). Real, valid GitHub
Actions YAML with `{{TOKEN}}` placeholders:

```yaml
# .github/workflows/docs.yml — GitHub Pages deploy (Bun + pnpm)
# Generated by doc-site-plugin. Env-driven SITE/BASE_PATH (REQ-CORE-02/DEPLOY-02).
name: docs

on:
  push:
    branches: ["{{DEFAULT_BRANCH}}"]
    paths:
      - "{{DOCS_PKG_DIR}}/**"
      - "docs/**"
      - "docs.manifest.json"
      - ".github/workflows/docs.yml"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2

      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      - name: Configure Pages
        id: pages
        uses: actions/configure-pages@v5

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build docs site
        run: pnpm --filter ./{{DOCS_PKG_DIR}} build
        env:
          # Env-driven site/base — consumed by {{DOCS_PKG_DIR}}/astro.config.mjs
          # (03-core-site-and-manifest.md). Subpath base => assets resolve on
          # the project Pages subpath /{repo}/.
          SITE: ${{ steps.pages.outputs.origin }}
          BASE_PATH: ${{ steps.pages.outputs.base_path }}

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: "{{DOCS_PKG_DIR}}/dist"

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

> `${{ ... }}` sequences above are **GitHub Actions expressions**, not generator
> tokens — generator tokens are `{{UPPER_SNAKE}}` with no leading `$`. The
> token-coverage test (`10-testing-strategy.md`) scans only `{{TOKEN}}` forms,
> so GH Actions `${{ }}` expressions are not mistaken for generator tokens.

`actions/configure-pages@v5` populates `steps.pages.outputs.origin`
(`https://<owner>.github.io`) and `steps.pages.outputs.base_path`
(`/<repo>` for a project site). Feeding these into `SITE`/`BASE_PATH` is what
makes the subpath base **fully runtime-derived** — no `{{REPO_SLUG}}` hardcode is
needed in the workflow body (it is used only if a fallback literal base is
requested in the interview; see §3.6).

### 3.5 The template — Node + npm fragment

The Node+npm fragment differs only in the setup + install + build steps:

```yaml
      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: lts/*
          cache: npm

      - name: Configure Pages
        id: pages
        uses: actions/configure-pages@v5

      - name: Install dependencies
        run: npm ci

      - name: Build docs site
        run: npm run build --workspace {{DOCS_PKG_DIR}}
        env:
          SITE: ${{ steps.pages.outputs.origin }}
          BASE_PATH: ${{ steps.pages.outputs.base_path }}
```

For a **single-package** target (no workspaces), the Node build step instead
runs in the package directory:

```yaml
      - name: Build docs site
        run: npm run build
        working-directory: {{DOCS_PKG_DIR}}
        env:
          SITE: ${{ steps.pages.outputs.origin }}
          BASE_PATH: ${{ steps.pages.outputs.base_path }}
```

### 3.6 Path-filtered triggers (canon faithfulness)

The `paths:` filter scopes CI to docs-relevant changes (canon row: "Triggers on
docs/spec/workflow paths"):
- `{{DOCS_PKG_DIR}}/**` — the docs package source.
- `docs/**` — repo-root markdown that symlink mode bridges in
  (`04-content-symlink-layer.md`).
- `docs.manifest.json` — the single source of truth (`00 §2`); a sidebar/page
  change must rebuild.
- `.github/workflows/docs.yml` — self-trigger so workflow edits redeploy.

If the interview supplies an explicit literal base (rare; e.g. a custom-domain
Pages site served at root), the agent emits `BASE_PATH: ""` and
`SITE: https://<custom-domain>` in place of the `steps.pages.outputs.*`
references, using `{{SITE_URL}}` / `{{BASE_PATH}}` (`00 §4.1`). The default and
canonical path is the runtime-derived subpath shown in §3.4.

### 3.7 Error handling

| Condition                                            | Behavior                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `actions/configure-pages` fails (Pages not enabled)  | Job fails; the workflow log instructs enabling Pages → Source: "GitHub Actions". The generator's next-steps output (REQ-VERIFY-03) notes this prerequisite. |
| Build step nonzero exit                              | Workflow fails; artifact not uploaded; no deploy. Mirrors the local build-smoke contract (`BUILD_RED`, `00 §7`). |
| `{{DEFAULT_BRANCH}}` undetected                       | Detection default `main` with assumption `ASSUME-BRANCH-MAIN` (`00 §6.1`), surfaced to the user. |

## 4. Vercel — `deploy/vercel/vercel.json.tmpl`

### 4.1 Target path & role

Resolved file: `vercel.json` at the **target repo root**. Configures Vercel to
build the docs package and serve its static output at the **root** of the
production URL — no subpath, so `BASE_PATH` is empty and no base-path juggling is
needed (PRD REQ-DEPLOY-01; canon "Vercel" row).

### 4.2 Tokens consumed

| Token             | Role                                                              |
| ----------------- | ---------------------------------------------------------------- |
| `{{DOCS_PKG_DIR}}` | Build command working scope + output directory location.        |
| `{{PKG_MANAGER}}`  | Install + build command.                                         |
| `{{SITE_URL}}`     | Production URL → `SITE` build env (root host).                   |

`{{BASE_PATH}}` is **empty** for Vercel (root-hosted, `00 §4.1` default).

### 4.3 The template

`deploy/vercel/vercel.json.tmpl` (Bun+pnpm shown; the `installCommand` /
`buildCommand` swap to `npm ci` / `npm run build ...` for the Node toolchain per
§3.3):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "pnpm --filter ./{{DOCS_PKG_DIR}} build",
  "installCommand": "pnpm install --frozen-lockfile",
  "outputDirectory": "{{DOCS_PKG_DIR}}/dist",
  "framework": "astro",
  "build": {
    "env": {
      "SITE": "{{SITE_URL}}",
      "BASE_PATH": ""
    }
  }
}
```

- `SITE` = the production URL (`{{SITE_URL}}`); `BASE_PATH` = `""` so Astro emits
  root-relative assets (PRD §8: "Vercel/static root assets resolve").
- `outputDirectory` points at the package's `dist/`, the same artifact the local
  build smoke test produces (`08-rerun-and-verification.md`).
- For a **single-package** repo, `buildCommand` is `pnpm build` /
  `npm run build` and `outputDirectory` is `dist` (the `{{DOCS_PKG_DIR}}` prefix
  is the package dir itself); the agent selects the matching fragment line.

### 4.4 Error handling

| Condition                              | Behavior                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `{{SITE_URL}}` unknown at scaffold time | Interview supplies it; if deferred, the agent writes `"SITE": ""` and the next-steps output (REQ-VERIFY-03) tells the user to set `SITE` in Vercel project env. Astro tolerates an empty `site` (canonical links only). |
| Wrong package manager in Vercel UI      | The `installCommand`/`buildCommand` in `vercel.json` override the UI guess, so the detected toolchain (REQ-PORT-01) wins. |

## 5. Generic static / Netlify — `deploy/static/netlify.toml.tmpl`

### 5.1 Target path & role

Resolved file: `netlify.toml` at the **target repo root**, plus documented
static-host instructions (emitted into the next-steps output and the skill's
`references/deploy-static-netlify.md`). A plain build to `dist/` for any static
host; `base` is configurable (canon "Generic static / Netlify" row).

### 5.2 Tokens consumed

| Token             | Role                                              |
| ----------------- | ------------------------------------------------- |
| `{{DOCS_PKG_DIR}}` | Build `base` directory + publish directory.      |
| `{{PKG_MANAGER}}`  | Build command.                                    |
| `{{SITE_URL}}`     | `SITE` build env (root host by default).          |
| `{{BASE_PATH}}`    | `BASE_PATH` build env — empty (root) by default; set to `/<subdir>` if the host serves on a subpath. |

### 5.3 The template

`deploy/static/netlify.toml.tmpl`:

```toml
# netlify.toml — generated by doc-site-plugin.
# Env-driven SITE/BASE_PATH (REQ-CORE-02/DEPLOY-02); root-hosted by default.

[build]
  base = "{{DOCS_PKG_DIR}}"
  command = "pnpm build"
  publish = "dist"

[build.environment]
  SITE = "{{SITE_URL}}"
  BASE_PATH = "{{BASE_PATH}}"
```

- `base` is the docs package directory; `publish` is its `dist/` (relative to
  `base`). With `base` set, Netlify runs the package build directly, so
  `command` is the package-local `pnpm build` / `npm run build` regardless of
  monorepo vs single (no `--filter` needed). The agent swaps `pnpm`→`npm` per
  `{{PKG_MANAGER}}`.
- Root host ⇒ `{{BASE_PATH}}` = `""` (default, `00 §4.1`). If the user states
  the host serves the site under a subpath, the interview sets `{{BASE_PATH}}` to
  `/<subdir>` and the same env-driven mechanism (§6) applies — still no
  site-code edit.

### 5.4 Documented static-host instructions (non-Netlify)

For a generic static host (S3, Cloudflare Pages, nginx, etc.), `netlify.toml` is
inert; the emitted `references/deploy-static-netlify.md` documents the manual
recipe, which the next-steps output (REQ-VERIFY-03) echoes:

```
1. Build:   SITE=<your-url> BASE_PATH=<""|/subpath> <pkgmgr> --filter ./<docs-dir> build
2. Publish: upload the contents of <docs-dir>/dist/ to your host's web root
            (or the /subpath/ directory if BASE_PATH is non-empty).
```

### 5.5 Error handling

| Condition                          | Behavior                                                                |
| ---------------------------------- | ---------------------------------------------------------------------- |
| Subpath host, `BASE_PATH` left empty | Assets 404 under the subpath. Documented in §5.4; the user sets `BASE_PATH=/subpath`. No code change (§6). |
| `{{SITE_URL}}` deferred             | `SITE = ""` emitted; next-steps notes setting it in the host's build env. |

## 6. Shared env-driven `site`/`base` (REQ-DEPLOY-02, REQ-CORE-02)

### 6.1 The single mechanism

All three targets set **the same two environment variables** at build time —
`SITE` and `BASE_PATH` — and **never** edit site code. The core
`astro.config.mjs` (owned by `03-core-site-and-manifest.md`) reads them once:

```js
// Contract this document relies on — DEFINED IN 03-core-site-and-manifest.md.
// astro.config.mjs reads SITE / BASE_PATH from the build environment:
//   site: process.env.SITE || undefined,
//   base: process.env.BASE_PATH || undefined,
// (passthroughImageService(), sidebar, etc. also live there — not here.)
```

> This block is **illustrative of the contract**, not a redefinition. The
> authoritative `astro.config.mjs` is in `03-core-site-and-manifest.md`. If that
> document's resolved config does not read `process.env.SITE` and
> `process.env.BASE_PATH`, this subsystem is broken — see Verification §8.
> WARNING: `03-core-site-and-manifest.md` is authored by a sibling document and
> was not present at the time this spec was written — verify the env-var names
> `SITE` / `BASE_PATH` match exactly before implementing.

### 6.2 How each target supplies the two vars

| Target          | `SITE` source                                  | `BASE_PATH` source                          | Effect              |
| --------------- | ---------------------------------------------- | ------------------------------------------- | ------------------- |
| GitHub Pages    | `steps.pages.outputs.origin` (runtime)         | `steps.pages.outputs.base_path` = `/<repo>` | subpath base — assets resolve under `/<repo>/` |
| Vercel          | `{{SITE_URL}}` in `vercel.json` `build.env`     | `""`                                        | root base           |
| Static/Netlify  | `{{SITE_URL}}` in `netlify.toml` `[build.environment]` | `{{BASE_PATH}}` (`""` default)        | root (or configured subpath) |

Because the **only** per-target difference is two environment values, switching
deploy targets — or adding a second one — requires zero edits to
`astro.config.mjs` or any page (REQ-DEPLOY-02). This is the keystone the PRD §8
success criteria check ("the same build works on a subpath or at root without
code changes").

### 6.3 Coexistence

Multiple targets may be selected at once (`deploy = ["github-pages", "vercel"]`).
Their files do not overlap (`.github/workflows/docs.yml`, `vercel.json`,
`netlify.toml` are distinct paths), and each carries its own env values, so they
do not conflict. The shared core config serves all of them unchanged.

## 7. Monorepo portability — `monorepo/` group (REQ-PORT-03, REQ-PORT-01)

### 7.1 Gating

Emitted **iff** `monorepo = true` in the selection record (`00 §5`, seeded by
detection `02-detection-and-interview.md`). For a single-package target the
group is skipped entirely (REQ-USE-01): there is no workspace manifest to
register into and the docs package's own scripts (owned by `03`) suffice.

### 7.2 Package-manager matching (REQ-PORT-01)

The workspace registration target depends on the detected package manager:

| `{{PKG_MANAGER}}` | Workspace registry                              | Fragment emitted                          |
| ----------------- | ----------------------------------------------- | ----------------------------------------- |
| `pnpm`            | `pnpm-workspace.yaml` (`packages:` list)        | `monorepo/pnpm-workspace.fragment.yaml.tmpl` |
| `npm`             | root `package.json` `workspaces` array          | `monorepo/root-scripts.fragment.json.tmpl` (`workspaces` + `scripts`) |

In both cases the agent **merges** the registration into the existing root file
(creating it if absent), never overwriting unrelated keys. The merge is an
additive operation, not a full-file template copy.

### 7.3 The fragments

**`monorepo/pnpm-workspace.fragment.yaml.tmpl`** — the entry to ensure exists in
`pnpm-workspace.yaml` `packages:`:

```yaml
# Merge into pnpm-workspace.yaml — register the docs package as a workspace member.
packages:
  - "{{DOCS_PKG_DIR}}"
```

**`monorepo/root-scripts.fragment.json.tmpl`** — the keys to merge into the root
`package.json`. For npm this also carries the `workspaces` membership; the
passthrough `scripts` are emitted for **both** package managers (the `--filter`
form for pnpm, the `--workspace` form for npm):

```json
{
  "workspaces": ["{{DOCS_PKG_DIR}}"],
  "scripts": {
    "dev:docs": "pnpm --filter ./{{DOCS_PKG_DIR}} dev",
    "build:docs": "pnpm --filter ./{{DOCS_PKG_DIR}} build"
  }
}
```

For the **npm** toolchain the script values use the npm workspace form (selected
by fragment, no in-template logic — `00 §4`):

```json
{
  "workspaces": ["{{DOCS_PKG_DIR}}"],
  "scripts": {
    "dev:docs": "npm run dev --workspace {{DOCS_PKG_DIR}}",
    "build:docs": "npm run build --workspace {{DOCS_PKG_DIR}}"
  }
}
```

These passthroughs mirror the canon root `package.json` `dev:docs`/`build:docs`
row (CON-04) so the docs site is a **first-class workspace member** invokable
from the repo root (REQ-PORT-03). For pnpm, `workspaces` is not added to
`package.json` (pnpm uses `pnpm-workspace.yaml`); only the `scripts` keys merge
into root `package.json`.

### 7.4 Merge semantics & re-run

Because §7.3 fragments **merge into pre-existing user files**, they are handled
differently from full-file plumbing (§3–§5):

1. **Register membership idempotently** — add `{{DOCS_PKG_DIR}}` to the
   workspace list only if not already present (string-equality on the
   POSIX-relative path). A second run is a no-op (REQ-REL-01).
2. **Add passthrough scripts** — set `scripts.dev:docs` / `scripts.build:docs`.
   If a key already exists with a **different** value (user-edited), apply the
   never-clobber rule: skip + flag (`RERUN_SKIP`, `00 §7`; decision table
   `00 §3.3`) rather than overwrite.
3. The root `package.json` / `pnpm-workspace.yaml` are **not** wholesale-tracked
   in `.doc-site-scaffold.json` `files` (they are user-owned root files); only
   the *generator-managed keys* are reconciled, per the re-run policy in
   `08-rerun-and-verification.md`.

### 7.5 Error handling

| Condition                                       | Behavior                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| No root `package.json` in a detected monorepo   | Treat as detection ambiguity; surface `ASSUME-MONOREPO-SINGLE` reconsideration (`00 §6.1`) or create minimal root manifest with just the merged keys, flagged to the user (REQ-USE-02). |
| `pnpm-workspace.yaml` malformed YAML            | Do not silently rewrite; report `PARTIAL_EMISSION`-style flag (`00 §7`) for that step and leave the file untouched. |
| Passthrough script collides with user value     | `RERUN_SKIP` (§7.4 step 2) — never clobber. |
| Detected pkg manager mismatches actual lockfile | Detection layer (`02`) resolves authoritatively; this group consumes `{{PKG_MANAGER}}` and emits the matching registry only (REQ-PORT-01). |

## 8. Worked example

Interview selects `deploy = ["github-pages", "vercel"]`, `monorepo = true`,
Bun+pnpm, `{{DOCS_PKG_DIR}} = packages/docs`, `{{DEFAULT_BRANCH}} = main`,
`{{SITE_URL}} = https://docs.acme.dev`. The generator emits:

- `.github/workflows/docs.yml` (Bun+pnpm fragment, §3.4) — `pnpm --filter
  ./packages/docs build`, `SITE`/`BASE_PATH` from `configure-pages`.
- `vercel.json` (§4.3) — `outputDirectory: "packages/docs/dist"`,
  `"SITE": "https://docs.acme.dev"`, `"BASE_PATH": ""`.
- Merge `- "packages/docs"` into `pnpm-workspace.yaml` (§7.3).
- Merge `dev:docs` / `build:docs` pnpm passthroughs into root `package.json`
  (§7.3).
- **No** `netlify.toml` (static-netlify not selected — REQ-USE-01).

The same `astro.config.mjs` (from `03`) serves both hosts: subpath on Pages,
root on Vercel, no code change (§6).

## Dependencies

- **`00-core-definitions.md`** — token vocabulary (§4: `SITE_URL`, `BASE_PATH`,
  `REPO_SLUG`, `PKG_MANAGER`, `RUNTIME`, `DEFAULT_BRANCH`, `DOCS_PKG_DIR`);
  component-selection model (§5: `deploy[]`, `monorepo`); provenance manifest
  (§3) and re-run decision table (§3.3); error taxonomy (§7); assumption codes
  (§6.1). **Implement first.**
- **`01-architecture-layout.md`** — template-group layout (§2.2:
  `deploy/github-pages/`, `deploy/vercel/`, `deploy/static/`, `monorepo/`) and
  the asset paths under `references/templates/`. **Implement first.**
- **`03-core-site-and-manifest.md`** — owns the env-driven `astro.config.mjs`
  that consumes `SITE`/`BASE_PATH` (§6 contract). This subsystem supplies those
  vars; it does not define the consumer. **Must agree on the env-var names.**
- **`02-detection-and-interview.md`** — sources the token values
  (`PKG_MANAGER`, `RUNTIME`, `DEFAULT_BRANCH`, `monorepo`, `deploy[]`).

## Verification

How to confirm an implementation matches this spec (maps to PRD §8 deploy
success criteria):

- [ ] **GH Pages subpath assets resolve** — building with `SITE` =
      `https://<owner>.github.io`, `BASE_PATH` = `/<repo>` produces a `dist/`
      whose HTML references assets under `/<repo>/…`. (PRD §8.)
- [ ] **Vercel/static root assets resolve** — building with `BASE_PATH = ""`
      produces `dist/` HTML referencing root-relative assets (`/…`). (PRD §8.)
- [ ] Each deploy file is emitted **only** when its key is in `deploy[]`; with
      `deploy = []` none of `.github/workflows/docs.yml`, `vercel.json`,
      `netlify.toml` exists (REQ-USE-01; scaffold-output fixture, `10`).
- [ ] Selecting/changing a deploy target produces a **zero-line diff** in
      `astro.config.mjs` and all pages (REQ-DEPLOY-02).
- [ ] The Bun+pnpm fragment is emitted iff `{{RUNTIME}}=bun`/`{{PKG_MANAGER}}=pnpm`;
      Node+npm fragment iff `node`/`npm` (REQ-PORT-01; golden scaffold fixtures).
- [ ] With `monorepo = true`, `{{DOCS_PKG_DIR}}` appears in `pnpm-workspace.yaml`
      (pnpm) or root `package.json` `workspaces` (npm), and root
      `dev:docs`/`build:docs` scripts exist with the matching filter/workspace
      form (REQ-PORT-03).
- [ ] With `monorepo = false`, none of the `monorepo/` fragments are applied.
- [ ] Re-running with identical inputs leaves the workspace registration and
      passthrough scripts byte-identical (REQ-REL-01); a user-edited `dev:docs`
      is skipped + flagged, not clobbered (§7.4, `00 §3.3`).
- [ ] Every `{{TOKEN}}` used in §3–§7 appears in `00 §4.1` (token-coverage test,
      `10-testing-strategy.md`).
