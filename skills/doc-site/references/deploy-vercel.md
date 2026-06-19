# Deploy target — Vercel

Emitted **iff** `"vercel" ∈ deploy` (selection record, `00 §5`). Template group:
`templates/deploy/vercel/`. Resolved target file: `vercel.json` at the **target
repo root** (06 §4).

## Role

Configures Vercel to build the docs package and serve its static output at the
**root** of the production URL — no subpath, so `BASE_PATH` is empty and no
base-path juggling is needed. It supplies the shared env-driven `SITE`/`BASE_PATH`
vars consumed by the core `astro.config.mjs`; it never edits site code
(REQ-DEPLOY-02).

## Tokens consumed (all from `00 §4.1`)

| Token              | Role                                           |
| ------------------ | ---------------------------------------------- |
| `{{DOCS_PKG_DIR}}` | Build scope + `outputDirectory` location.      |
| `{{PKG_MANAGER}}`  | Selects the install/build command fragment.    |
| `{{SITE_URL}}`     | Production URL → `SITE` build env (root host). |

`{{BASE_PATH}}` is **not** a token here: Vercel is root-hosted, so the template
hardcodes `"BASE_PATH": ""` (the `00 §4.1` default).

## Toolchain fragment selection (REQ-PORT-01)

`vercel.json.tmpl` shows the **Bun + pnpm** form. For the **Node + npm**
toolchain the agent swaps `installCommand`/`buildCommand` per `{{PKG_MANAGER}}`
(fragment selection, no in-template logic — `00 §4`):

| Toolchain  | `installCommand`                 | `buildCommand`                               |
| ---------- | -------------------------------- | -------------------------------------------- |
| Bun + pnpm | `pnpm install --frozen-lockfile` | `pnpm --filter ./{{DOCS_PKG_DIR}} build`     |
| Node + npm | `npm ci`                         | `npm run build --workspace {{DOCS_PKG_DIR}}` |

For a **single-package** repo, `buildCommand` is `pnpm build` / `npm run build`
and `outputDirectory` is `dist` (the `{{DOCS_PKG_DIR}}` prefix is the package dir
itself). The `installCommand`/`buildCommand` in `vercel.json` override the Vercel
UI's package-manager guess, so the detected toolchain wins (REQ-PORT-01).

## Shared env-driven SITE/BASE_PATH (REQ-DEPLOY-02, REQ-CORE-02)

`build.env` sets the same two vars every target uses:

- `"SITE": "{{SITE_URL}}"` — the production URL.
- `"BASE_PATH": ""` — empty, so Astro emits **root-relative** assets (PRD §8:
  "Vercel/static root assets resolve").

The core `astro.config.mjs` (owned by `03`, see `core.md`) reads
`process.env.SITE` / `process.env.BASE_PATH`. Because the only per-target
difference is these two env values, adding Vercel alongside (say) GitHub Pages
needs **zero** edits to `astro.config.mjs` or any page. `outputDirectory` points
at the package's `dist/` — the same artifact the local build smoke test produces
(`rerun.md`), and `framework: "astro"` lets Vercel apply Astro defaults.

## Errors

- `{{SITE_URL}}` unknown at scaffold time → the agent writes `"SITE": ""` and the
  next-steps output (REQ-VERIFY-03) tells the user to set `SITE` in the Vercel
  project env. Astro tolerates an empty `site` (canonical links only).

## Re-run

`vercel.json` is a managed plumbing file: its sha256 is recorded in
`.doc-site-scaffold.json` and it is subject to never-clobber on re-run
(`rerun.md`, `00 §3.3`).
