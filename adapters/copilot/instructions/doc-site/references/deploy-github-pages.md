# Deploy target — GitHub Pages

Emitted **iff** `"github-pages" ∈ deploy` (selection record, `00 §5`). Template
group: `templates/deploy/github-pages/`. Resolved target file:
`.github/workflows/docs.yml` (06 §3).

## Role

A GitHub Actions workflow that builds the docs package and deploys it to
**project** GitHub Pages, served at a subpath (`https://<owner>.github.io/<repo>/`).
It supplies the shared env-driven `SITE`/`BASE_PATH` vars that the core
`astro.config.mjs` consumes (see _Shared env-driven SITE/BASE_PATH_ below) — it
never edits site code (REQ-DEPLOY-02).

## Tokens consumed (all from `00 §4.1`)

| Token                | Role                                                     |
| -------------------- | -------------------------------------------------------- |
| `{{DEFAULT_BRANCH}}` | Branch whose pushes trigger a deploy (default `main`).   |
| `{{DOCS_PKG_DIR}}`   | Path-filter prefix, build scope, and artifact directory. |
| `{{PKG_MANAGER}}`    | Selects the toolchain fragment (`pnpm` vs `npm`).        |
| `{{RUNTIME}}`        | Selects the setup action (`bun` vs `node`).              |
| `{{REPO_SLUG}}`      | Only for the rare literal-base fallback (see below).     |

> The `${{ ... }}` sequences in the workflow are **GitHub Actions expressions**,
> not generator tokens. Generator tokens are `{{UPPER_SNAKE}}` with no leading
> `$`, so the token-coverage test (`10`) does not flag the Actions expressions.

## Toolchain fragment selection (REQ-PORT-01)

The template ships **two named fragments**, selected by the agent from the
detected `{{RUNTIME}}`/`{{PKG_MANAGER}}` — **never** an in-YAML conditional
(`00 §4`):

| Detected   | `{{RUNTIME}}` | `{{PKG_MANAGER}}` | Setup action            | Install                          | Build invocation                                                                                                               |
| ---------- | ------------- | ----------------- | ----------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Bun + pnpm | `bun`         | `pnpm`            | `oven-sh/setup-bun@v2`  | `pnpm install --frozen-lockfile` | `pnpm --filter ./{{DOCS_PKG_DIR}} build`                                                                                       |
| Node + npm | `node`        | `npm`             | `actions/setup-node@v4` | `npm ci`                         | `npm run build --workspace {{DOCS_PKG_DIR}}` (monorepo) or `npm run build` with `working-directory: {{DOCS_PKG_DIR}}` (single) |

In `docs.yml.tmpl` the **Bun + pnpm** fragment is the active set of steps; the
**Node + npm** fragment is provided as a clearly delimited commented block. The
agent emits exactly one fragment: it leaves Bun+pnpm in place, or replaces those
steps with the Node+npm block (and picks the monorepo `--workspace` line vs the
single-package `working-directory` line). The single-vs-monorepo build line is
the same fragment-selection mechanism.

## Path-filtered triggers (canon faithfulness)

The workflow triggers on `push` to `{{DEFAULT_BRANCH}}` filtered to docs-relevant
paths (plus `workflow_dispatch`):

- `{{DOCS_PKG_DIR}}/**` — the docs package source.
- `docs/**` — repo-root markdown bridged in by symlink mode (`04`).
- `docs.manifest.json` — the single source of truth (`00 §2`); sidebar/page
  changes must rebuild.
- `.github/workflows/docs.yml` — self-trigger so workflow edits redeploy.

## Shared env-driven SITE/BASE_PATH (REQ-DEPLOY-02, REQ-CORE-02)

The build step sets two environment variables and nothing else:

- `SITE: ${{ steps.pages.outputs.origin }}` — `https://<owner>.github.io`.
- `BASE_PATH: ${{ steps.pages.outputs.base_path }}` — `/<repo>` for a project
  site (the subpath).

Both come from the `actions/configure-pages@v5` step output, so the subpath base
is **fully runtime-derived** — no `{{REPO_SLUG}}` hardcode in the workflow body.
The core `astro.config.mjs` (owned by `03`, see `core.md`) reads
`process.env.SITE` / `process.env.BASE_PATH`, so the subpath base makes assets
resolve under `/<repo>/` (PRD §8). Switching to or adding another deploy target
needs **zero** edits to `astro.config.mjs` or any page — the only per-target
difference is these two env values.

**Literal-base fallback (rare).** For a custom-domain Pages site served at root,
the interview can request a literal base: the agent emits `SITE: {{SITE_URL}}`
and `BASE_PATH: {{BASE_PATH}}` (`""`) in place of the `steps.pages.outputs.*`
references. The default and canonical path is the runtime-derived subpath above.

## Prerequisites & errors

- Pages must be enabled with **Source: GitHub Actions**; if `configure-pages`
  fails, the job fails and the next-steps output (REQ-VERIFY-03) flags the
  prerequisite.
- A nonzero build step fails the workflow (no artifact, no deploy), mirroring the
  local `BUILD_RED` contract (`00 §7`).
- Undetected default branch falls back to `main` with assumption
  `ASSUME-BRANCH-MAIN` (`00 §6.1`), surfaced to the user.

## Re-run

`.github/workflows/docs.yml` is a managed plumbing file: its sha256 is recorded
in `.doc-site-scaffold.json` and it is subject to never-clobber on re-run
(`rerun.md`, `00 §3.3`).
