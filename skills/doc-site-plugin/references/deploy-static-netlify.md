# Deploy target — generic static / Netlify

Emitted **iff** `"static-netlify" ∈ deploy` (selection record, `00 §5`). Template
group: `templates/deploy/static/`. Resolved target file: `netlify.toml` at the
**target repo root**, plus the documented generic static-host recipe below
(06 §5).

## Role

A plain build to `dist/` for any static host. `netlify.toml` wires Netlify
directly; for other static hosts (S3, Cloudflare Pages, nginx, …) the file is
inert and the manual recipe applies. It supplies the shared env-driven
`SITE`/`BASE_PATH` vars consumed by the core `astro.config.mjs`; it never edits
site code (REQ-DEPLOY-02).

## Tokens consumed (all from `00 §4.1`)

| Token              | Role                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `{{DOCS_PKG_DIR}}` | Build `base` directory (publish `dist` is relative to it).                                |
| `{{PKG_MANAGER}}`  | Selects the build command (`pnpm` vs `npm run`).                                          |
| `{{SITE_URL}}`     | `SITE` build env (root host by default).                                                  |
| `{{BASE_PATH}}`    | `BASE_PATH` build env — `""` (root) by default; `/<subdir>` if the host serves a subpath. |

## Toolchain fragment selection (REQ-PORT-01)

`netlify.toml.tmpl` shows the **Bun + pnpm** `command = "pnpm build"`. For the
**Node + npm** toolchain the agent swaps it to `command = "npm run build"`
(fragment selection, no in-template logic — `00 §4`). Because `base` is set to the
docs package directory, Netlify runs the package build directly, so **no
`--filter`/`--workspace` is needed** regardless of monorepo vs single.

## Shared env-driven SITE/BASE_PATH (REQ-DEPLOY-02, REQ-CORE-02)

`[build.environment]` sets the same two vars every target uses:

- `SITE = "{{SITE_URL}}"` — the production URL.
- `BASE_PATH = "{{BASE_PATH}}"` — `""` (root) by default; if the host serves the
  site under a subpath, the interview sets `{{BASE_PATH}}` to `/<subdir>` and the
  same env-driven mechanism applies — still no site-code edit.

The core `astro.config.mjs` (owned by `03`, see `core.md`) reads
`process.env.SITE` / `process.env.BASE_PATH`. With `BASE_PATH = ""`, Astro emits
root-relative assets (PRD §8). Switching to or adding this target needs **zero**
edits to `astro.config.mjs` or any page — the only per-target difference is these
two env values.

## Generic static-host recipe (non-Netlify)

For any host that does not read `netlify.toml`, run the same env-driven build by
hand and upload the output (echoed by the next-steps output, REQ-VERIFY-03):

```
1. Build:   SITE=<your-url> BASE_PATH=<""|/subpath> <pkgmgr> --filter ./<docs-dir> build
2. Publish: upload the contents of <docs-dir>/dist/ to your host's web root
            (or the /subpath/ directory if BASE_PATH is non-empty).
```

## Errors

- Subpath host with `BASE_PATH` left empty → assets 404 under the subpath; the
  user sets `BASE_PATH=/subpath` (no code change).
- `{{SITE_URL}}` deferred → `SITE = ""` emitted; next-steps notes setting it in
  the host's build env.

## Re-run

`netlify.toml` is a managed plumbing file: its sha256 is recorded in
`.doc-site-scaffold.json` and it is subject to never-clobber on re-run
(`rerun.md`, `00 §3.3`).
