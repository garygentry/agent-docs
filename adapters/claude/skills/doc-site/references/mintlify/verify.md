# Mintlify verify (Phase 6) — agent reference

Mintlify has **no build step**, so the Astro build smoke test (`rerun.md §6`) does not apply.
Verify instead with the `mint` CLI. This is the `BUILD_RED` analogue for Mintlify.

## 0. Ensure the `mint` CLI is available

```sh
mint --version
```

- **Present** → proceed.
- **Absent** → this is `MINT_CLI_MISSING`. Offer to install it (`npm i -g mint`) and, on the
  user's OK, install then proceed. If the user declines or install fails, **skip** the CLI checks
  and record a `MINT_CLI_MISSING` assumption in the Phase 7 summary. **Never report success on a
  skipped verify** — the scaffold is emitted but unverified, and you must say so.

`mint` is a global tool, not a repo dependency — nothing is pinned in `package.json`
(`rerun.md §4` is a no-op for Mintlify).

## 1. `mint validate` (strict) — the build-smoke analogue

```sh
mint validate        # run in {{DOCS_PKG_DIR}} (the Mintlify project root)
```

`mint validate` does a strict build validation and exits non-zero on any error or warning
(e.g. a `docs.json` page path with no file, a page missing `title`, malformed frontmatter). A
non-zero exit is `VALIDATE_RED`: report the failed check and remediation and **never report
success on red** (the exact mirror of `BUILD_RED`). A failure mid-emission is `PARTIAL_EMISSION`
— no rollback, flag the partial tree and the failed step (`rerun.md §7`).

> **Favicon path.** Mintlify serves static assets from the **project root**, not an
> Astro-style `public/` dir. The favicon is emitted at `{{DOCS_PKG_DIR}}/favicon.svg` to match
> `docs.json`'s `"favicon": "/favicon.svg"`; a stray `public/favicon.svg` makes `mint validate`
> log `Error generating favicons: ENOENT` (it still exits 0, but the icon is missing). The
> Phase-6 live smoke (native / symlink / OpenAPI / `both`) confirmed the root layout validates
> clean.

## 2. `mint broken-links` — the drift-guard analogue

```sh
mint broken-links    # add --check-anchors to also validate `#` anchors
```

This replaces `check-docs.mjs` entirely for Mintlify — it is Mintlify's first-party
internal-link checker. When the `driftGuard` component is selected under `renderer=mintlify`, do
**not** emit `check-docs.mjs`; instead wire the `broken-links` script (already in the emitted
`package.json`) into the repo gate, and run `mint broken-links` here. A broken internal link is
a drift finding — report it; treat it like the Starlight guard's `broken-link` rule.

## 3. Ordering in symlink/mixed mode

When `contentMode ∈ {symlink, mixed}`, the page bodies are materialized by `setup-docs.sh`
(Phase 5). Run it **before** `mint validate`/`mint broken-links`, or every symlinked page reads
as missing → false failure (the same ordering constraint as the Starlight drift guard,
`drift-guard.md §4`).

## 4. `both` mode

Run the Starlight build smoke test (`rerun.md §6`) **and** the Mintlify `mint` checks, both over
the shared content (`content-sourcing.md`). Additionally run the **portability lint** — flag any
renderer-specific MDX component (Starlight `<Card>` / Mintlify `<Steps>` etc.) that appears in a
page under the shared `content/` root, since such a page renders in only one container.

## 5. Next steps on success (Phase 7)

- **Preview:** `mint dev` in `{{DOCS_PKG_DIR}}` (localhost:3000).
- **Deploy:** per `deploy.md` — connect the repo in Mintlify's dashboard (primary), or
  `mint export` for a static host.
- **Content note** (symlink/mixed): re-run `setup-docs.sh` after editing the manifest/plan or
  pulling new source docs.
- Reprint all assumption records (including any `MINT_CLI_MISSING`) and `RERUN_SKIP` flags.
