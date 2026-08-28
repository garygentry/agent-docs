# Mintlify deploy (agent reference)

Mintlify's deploy model is fundamentally different from Starlight's static hosting. There are
**two** paths; guide the user to the right one. Unlike the Starlight deploy components, most of
this is **out-of-band** (account-gated dashboard actions) — the skill scaffolds `docs.json` and
prints steps, but cannot fully automate deployment. Set that expectation.

## Primary — Mintlify cloud (git-connected)

Mintlify hosts the site and rebuilds on every push once the repo is connected via Mintlify's
GitHub app. The skill's job is to ensure `docs.json` is valid and print the connect steps:

1. Sign in at the Mintlify dashboard and create a project (or open the existing one).
2. Install the Mintlify GitHub app on the repo and point it at `{{DOCS_PKG_DIR}}` (the folder
   containing `docs.json`).
3. Push to `{{DEFAULT_BRANCH}}` — Mintlify builds and serves automatically; configure the custom
   domain in the dashboard.

No workflow file or build command is emitted — Mintlify's app owns the build. (This is the
deliberate asymmetry vs Starlight, whose deploy is fully automatable to any static host.)

## Static escape hatch — `mint export`

For air-gapped or self-hosted deploys, or to publish to a static host without Mintlify's cloud:

```sh
mint export --output export.zip     # produces a static site archive
```

Unzip and serve the contents from any static host (S3, GitHub Pages, Netlify, Vercel static,
nginx, …). This reuses the static-hosting _concept_ from the Starlight deploy targets, but the
build command is `mint export`, not `astro build` — so the Astro deploy templates
(`deploy-*.md`) are **not** emitted for Mintlify. If the user wants CI for the static path, wire
a workflow that runs `mint export` and publishes the unzipped output; keep it a new,
path-filtered workflow (never edit foreign workflows), mirroring `deploy-github-pages.md`'s
safety rules.

## Next-steps output

Print whichever path the user chose, plus `mint dev` for local preview and the collected
assumption records (Phase 7, `verify.md §5`).
