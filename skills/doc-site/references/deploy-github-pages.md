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

| Token                 | Role                                                          |
| --------------------- | ------------------------------------------------------------- |
| `{{DEFAULT_BRANCH}}`  | Branch whose pushes trigger a deploy (default `main`).        |
| `{{DOCS_PKG_DIR}}`    | Path-filter prefix, build scope, and artifact directory.      |
| `{{CI_SETUP_ACTION}}` | **Derived** from `{{RUNTIME}}` — the runtime setup action.    |
| `{{INSTALL_CMD}}`     | **Derived** from `{{PKG_MANAGER}}` — frozen-lockfile install. |
| `{{WORKSPACE_BUILD}}` | **Derived** — the workspace/filter build invocation.          |
| `{{REPO_SLUG}}`       | Only for the rare literal-base fallback (see below).          |

> The `${{ ... }}` sequences in the workflow are **GitHub Actions expressions**,
> not generator tokens. Generator tokens are `{{UPPER_SNAKE}}` with no leading
> `$`, so the token-coverage test (`10`) does not flag the Actions expressions.

## Toolchain via derived tokens (REQ-PORT-01)

The workflow is a **single tokenized form** — there is no longer a coupled
Bun+pnpm / Node+npm pair to swap by hand. The runtime and package-manager axes
are **orthogonal**, expressed through the derived toolchain tokens (`SKILL.md`,
_Derived toolchain tokens_): `{{CI_SETUP_ACTION}}` (runtime), `{{INSTALL_CMD}}`
and `{{WORKSPACE_BUILD}}` (package manager). `npm`/`pnpm`/`yarn`/`bun` are all
supported.

Two structural mechanics are applied at the comment sentinels (not by an in-YAML
conditional, `00 §4`):

- **`# <<PKG_SETUP>>`** — when `{{PKG_MANAGER}}` is `pnpm`, inject a
  `pnpm/action-setup@v4` step (pnpm needs its own setup regardless of runtime);
  for `npm`/`yarn`/`bun` the sentinel line is removed (no extra setup step).
- **`# <<DRIFT_STEP>>`** — when `driftGuard` is selected, inject the drift-guard CI
  step from `templates/drift-guard/ci-step.github-pages.yaml.tmpl`; otherwise the
  sentinel line is removed (see `drift-guard.md §4`).

## Path-filtered triggers (canon faithfulness)

The workflow triggers on `push` to `{{DEFAULT_BRANCH}}` filtered to docs-relevant
paths (plus `workflow_dispatch`):

- `{{DOCS_PKG_DIR}}/**` — the docs package source.
- `docs/**` — repo-root markdown bridged in by symlink mode (`04`); meaningful
  **only** in symlink/mixed mode.
- `{{DOCS_PKG_DIR}}/docs.manifest.json` — the single source of truth (`00 §2`).
- `.github/workflows/docs.yml` — self-trigger so workflow edits redeploy.

**Dedup the resolved list.** When `{{DOCS_PKG_DIR}}` is `docs`, the
`{{DOCS_PKG_DIR}}/**` filter and the literal `docs/**` bridge resolve to the same
string — the agent emits it **once** (the resolver dedupes preserving order). In
native mode the `docs/**` bridge is dropped entirely (no symlinked repo-root
markdown to watch).

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
