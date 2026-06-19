# API Reference

The concrete contracts `doc-site-plugin` works against: the token vocabulary, the
`docs.manifest.json` shape and its schema rules, the component-selection record, the
runtime scripts it emits (with their exit codes), the `.doc-site-scaffold.json`
provenance shape, and the shared deploy env contract. All of these are *implemented*
in `skills/doc-site-plugin/` and validated by `src/test/doc-site-*.test.ts`.

This skill exposes no programmatic API (no `src/` module). Its "interfaces" are the
emitted files and the scaffold-time contracts below.

---

## 1. The 17 substitution tokens

Emission is global literal `{{TOKEN}}` replacement. The vocabulary is **frozen at
exactly 17 tokens** — every token used under `references/templates/**` must appear in
the `SKILL.md` table and vice-versa (enforced by the token-coverage test). After
substitution, **no literal `{{…}}` may survive** in any emitted file.

| Token | Source | Default |
| --- | --- | --- |
| `{{SITE_TITLE}}` | interview | repo name (titlecased) |
| `{{SITE_DESC}}` | interview | `Documentation for <title>` |
| `{{SITE_URL}}` | interview / deploy target | `""` (env-driven at build) |
| `{{BASE_PATH}}` | deploy target (subpath vs root) | `""` |
| `{{REPO_SLUG}}` | detection (`git remote`) / interview | ask |
| `{{GITHUB_URL}}` | derived from `{{REPO_SLUG}}` | `""` |
| `{{PKG_MANAGER}}` | detection (lockfile / `packageManager`) | `npm` |
| `{{RUNTIME}}` | detection (`bun.lock` / `engines.node`) | `node` |
| `{{DOCS_PKG_DIR}}` | interview | `docs/` (single) / `packages/docs/` (monorepo) |
| `{{IMAGES_SRC_DIR}}` | interview / detection | `docs/images` |
| `{{ACCENT_LIGHT}}` | interview | canon default light accent |
| `{{ACCENT_DARK}}` | interview | canon default dark accent |
| `{{DEFAULT_BRANCH}}` | detection (`git symbolic-ref`) | `main` |
| `{{ASTRO_VERSION}}` | resolution (latest @ first scaffold; pin on re-run) | latest |
| `{{STARLIGHT_VERSION}}` | resolution | latest |
| `{{DOCS_PKG_DIR_TO_ROOT}}` | **derived** — one `..` per `{{DOCS_PKG_DIR}}` segment | derived |
| `{{SYMLINK_PAGE_LINES}}` | **derived/generated** — one `link_file` per `source: symlink` page | generated |

**Derived tokens.** `{{DOCS_PKG_DIR_TO_ROOT}}` = `..` repeated per path segment
(`docs` → `..`, `packages/docs` → `../..`). `{{SYMLINK_PAGE_LINES}}` expands to a
generated `link_file "<from>" "<slug>"` block from the manifest's `source: symlink`,
non-`unmanaged` pages, in manifest order.

> **Not tokens:** GitHub Actions `${{ ... }}` expressions in `docs.yml` are *not*
> generator tokens (generator tokens are `{{UPPER_SNAKE}}` with no leading `$`), so the
> token-coverage test does not flag them.

---

## 2. `docs.manifest.json` — the single source of truth

Written to the **target repo root** (alongside, not inside, the docs package), with a
`$schema` pointer so editors validate locally.

```jsonc
{
  "$schema": "./docs.manifest.schema.json",
  "site": {
    "title": "My Project Docs",
    "description": "Documentation for My Project",
    "social": { "github": "https://github.com/acme/myproject" }
  },
  "pages": [
    { "slug": "intro", "source": "symlink", "from": "docs/intro.md" },
    { "slug": "guides/setup", "source": "native" },
    { "slug": "legacy", "unmanaged": true }
  ]
}
```

- `site.title` — required, non-empty string.
- `site.description` — required string.
- `site.social` — optional `object<string,string>`; keys are Starlight social-icon
  names, values are URLs. (URL shape is **advisory only**, not schema-validated — the
  validators run ajv without `ajv-formats`.)
- `pages` — required ordered array (may be empty). **Array order is sidebar order.**

### 2.1 PageEntry contract

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `slug` | string | yes | Route slug, POSIX-style (`guides/setup`); **unique** across `pages`. |
| `source` | `"symlink"` \| `"native"` | required **unless** `unmanaged` | Where the page body comes from. |
| `from` | string (repo-relative path) | required **iff** `source: "symlink"`; **forbidden** otherwise | Repo-root markdown to symlink in. |
| `unmanaged` | boolean (default `false`) | no | Escape hatch — generator wires no sidebar entry or symlink for it. |

### 2.2 Schema validation rules

Enforced by `docs.manifest.schema.json` (Draft 2020-12, hand-authored, copied verbatim
into the target). A violation is a `SCHEMA_VIOLATION` — reject and write nothing
further:

1. `source: "symlink"` ⇒ `from` present and non-empty.
2. `source: "native"` ⇒ `from` absent.
3. `unmanaged: true` ⇒ `source`/`from` optional; page exempt from sidebar↔manifest
   parity **only**.
4. `unmanaged` absent/false ⇒ `source` required.
5. `slug` values unique across `pages`. **Note:** JSON Schema cannot express per-slug
   uniqueness across array items, so this rule is **delegated to the symlinker and the
   drift guard**, not the static schema — the schema legitimately *accepts* a
   duplicate-slug manifest. (This is why one schema test is `it.skip`-ed, with the
   pointer documented in the schema description and the test comment.)
6. Strict `additionalProperties: false` at **every** level.

### 2.3 The `unmanaged: true` escape hatch

A page the **user** owns, not the generator: no sidebar entry, no symlink. The drift
guard exempts it from sidebar↔manifest parity **only** — it still runs broken-link and
required-frontmatter checks over it. Scoped per-page, so every *managed* page stays
fully generated and cannot drift.

---

## 3. The component-selection record

The single structure (resolved in Phase 3) that gates which template groups emit:

```jsonc
{
  "contentMode": "symlink" | "native" | "mixed",   // question 4
  "diagrams": false,                                // default declined
  "deploy": [],            // ⊆ ["github-pages","vercel","static-netlify"], opt-in
  "driftGuard": false,                              // default declined
  "monorepo": false                                 // detection-seeded (Probe 1)
}
```

Emission gating: `core/` always; `symlink/` when `contentMode ∈ {symlink, mixed}`;
`diagrams/` when `diagrams`; `deploy/*` per `deploy[]`; `drift-guard/` when
`driftGuard`; `monorepo/` when `monorepo`. Declining a component emits **zero** of its
files (decline-all invariant).

---

## 4. Emitted runtime scripts

### 4.1 `setup-docs.sh` (symlink/mixed mode)

POSIX `sh` (no bashisms), `set -eu`, written to `{{DOCS_PKG_DIR}}/setup-docs.sh` mode
`0755`. Idempotent content symlinker.

- Resolves `REPO_ROOT` from its own location via `{{DOCS_PKG_DIR_TO_ROOT}}` (works from
  any CWD).
- One `link_file "<from>" "<slug>"` per `source: symlink`, non-`unmanaged` page
  (`{{SYMLINK_PAGE_LINES}}`), in manifest order; plus a `link_dir "{{IMAGES_SRC_DIR}}"
  "images"` (template-fixed, `ln -sfn` no-dereference).
- Links are **relative**; `assert_inside_repo` canonicalizes each source and **refuses**
  any that escapes `REPO_ROOT` (`REQ-SEC-02`).
- Wired into the core `package.json` as `predev`/`prebuild` (`sh ./setup-docs.sh`).
  When diagrams are also selected the composed `prebuild` runs **diagram generation
  first, then the symlink relink** so generated SVGs exist before `images/` is linked.

### 4.2 `check-docs.mjs` (drift guard, `driftGuard: true`)

stdlib-only ESM (`node:fs`/`path`/`url`), runs identically under `node` and `bun`,
location-independent (all paths from `import.meta.url`). Written to
`{{DOCS_PKG_DIR}}/check-docs.mjs`; wired as `docs:check` (`{{RUNTIME}} check-docs.mjs`).
Four rules:

| Rule | Checks |
| --- | --- |
| `broken-link` | Local markdown/image links resolve on disk (skips external/anchor/`mailto:`/`tel:`/`data:`), with a Starlight slug fallback. Runs over every page incl. symlinked & `unmanaged`. |
| `sidebar-parity` | `astro.config.mjs` sidebar lists exactly the **managed** manifest slugs in order. `unmanaged` pages exempt. |
| `orphaned-symlink` | Dangling content-dir symlinks **and** stale `source: symlink` pages whose link is absent. |
| `missing-frontmatter` | Any `.md`/`.mdx` lacking a `title` frontmatter key (Starlight minimum). Runs over every page incl. `unmanaged`. |

**Exit codes:** `0` clean · `1` drift findings (each `[<rule>] <file>:<line> — <msg>`
plus a `check-docs-json: {…}` trailer for CI) · `2` guard error (missing/invalid
manifest — lets CI distinguish "drift found" from "guard broken").

**Custom rules (never emitted).** The guard imports an optional
`{{DOCS_PKG_DIR}}/docs.drift.rules.mjs` *iff present*. It `export default`s an array of
`{ id, run(ctx) }`; each `run` receives `{ manifest, pages, managedPages, pageFiles,
docsPkgDir, contentDir, rel, fs }` and **returns** `Finding[]` (`{ rule, file, line,
message }`) — it must not call `process.exit`. May be `async`; a throwing rule is
caught and converted to a guard finding. Lets a repo add rules **without forking**
(`REQ-DRIFT-02`).

### 4.3 Vendored `diagram-render.mjs` (diagrams, `diagrams: true`)

Copied byte-for-byte (mode `0644`) from `../diagram-generator/scripts/diagram-render.mjs`
into the target at `scripts/diagram-render.mjs` (or `{{DOCS_PKG_DIR}}/scripts/…`).
Invoked via `{{RUNTIME}}` so it runs zero-install. Pinned to **`CONTRACT_VERSION
1.0.0`**, verified by `--version` **before** vendoring; any mismatch aborts the
component before its first write (no fallback renderer).

Prebuild invocation per spec, twice (light + dark), chained with `&&`, using
`--out-file` for slug-independent output paths:

```jsonc
{
  "diagrams": "node scripts/diagram-render.mjs src/diagrams/arch.json --theme light --accent '<ACCENT_LIGHT>' --format svg --out-file public/diagrams/arch.light.svg && node scripts/diagram-render.mjs src/diagrams/arch.json --theme dark --accent '<ACCENT_DARK>' --format svg --out-file public/diagrams/arch.dark.svg",
  "prebuild": "npm run diagrams"
}
```

**Renderer exit codes** (consumed from `00 §8`; any nonzero fails `prebuild` →
`BUILD_RED`, surfaced never masked):

| Exit | Meaning |
| --- | --- |
| 0 | OK |
| 2 | input/spec error (bad `DiagramSpec`) |
| 3 | render error (engine/layout) |
| 4 | output error (post-render assertion) |
| 5 | PNG error (a `--format both` run may leave a written SVG — still reported as failure) |
| 6 | IO error (FS write / path escape) |
| 64 | usage error (malformed emitted invocation — a generator defect) |

---

## 5. `.doc-site-scaffold.json` — provenance manifest

At the target repo root. Drives never-clobber re-runs.

```jsonc
{
  "version": "<scaffold-format version>",
  "diagramContract": "1.0.0",          // present ONLY when diagrams emitted
  "astroPin": "5.13.2",                // exact resolved version (no caret)
  "starlightPin": "0.36.0",
  "files": {
    "docs/astro.config.mjs": "sha256:<hex>",
    "docs/setup-docs.sh": "sha256:<hex>",
    "scripts/diagram-render.mjs": "sha256:<hex>"
    // one entry per managed plumbing file; the sha256 of the exact bytes written
  }
}
```

- **Recorded:** every managed plumbing file (core group, `setup-docs.sh`, vendored
  renderer + starter spec, each deploy file, `check-docs.mjs`, the copied schema,
  `docs.manifest.json`, monorepo-managed keys).
- **Never recorded:** `source: native` authored pages (their absence is what guarantees
  preservation), and the individual symlinks `setup-docs.sh` creates.

**Re-run decision per managed file** (`recorded` = provenance value, `actual` = on-disk
sha256):

| On-disk | vs. recorded | Action |
| --- | --- | --- |
| absent | — | `EMIT` |
| present | `actual == recorded` | `REGENERATE` (re-record) |
| present | `actual != recorded` | `SKIP_FLAG` → `RERUN_SKIP` |
| present | undefined (untracked) | `SKIP_FLAG` |
| native page | never recorded | `PRESERVE` |

**Version pin policy:** first scaffold resolves latest (`npm view astro version`,
`npm view @astrojs/starlight version`) and pins caret ranges in `package.json` + exact
versions in provenance. Re-run **preserves** pins (never re-resolves). Bumping is an
explicit, opt-in interview action. An opt-in known-good fallback pair (`astro 5.13.2`
/ `@astrojs/starlight 0.36.0`) covers offline/broken-latest.

---

## 6. Deploy env contract

Every deploy target sets exactly two build-env vars; the core `astro.config.mjs` reads
them via `process.env`. The **only** per-target difference is their values, so adding
or switching a target needs zero site-code edits.

| Target | File | `SITE` | `BASE_PATH` |
| --- | --- | --- | --- |
| GitHub Pages | `.github/workflows/docs.yml` | `${{ steps.pages.outputs.origin }}` (`https://<owner>.github.io`) | `${{ steps.pages.outputs.base_path }}` (`/<repo>`) — runtime-derived |
| Vercel | `vercel.json` (repo root) | `{{SITE_URL}}` | `""` (root-hosted) |
| Static / Netlify | `netlify.toml` (repo root) | `{{SITE_URL}}` | `""` (root) or `/subpath` |

Toolchain differences (Bun+pnpm vs Node+npm, single vs monorepo) are handled by
**named template fragments** the agent selects per `{{RUNTIME}}`/`{{PKG_MANAGER}}` —
never an in-file conditional. GitHub Pages supports a rare literal-base fallback
(`SITE: {{SITE_URL}}`, `BASE_PATH: {{BASE_PATH}}`) for custom-domain root sites.

---

## 7. Outcome taxonomy

The agent reports one of these (`00 §7`):

| Outcome | Meaning |
| --- | --- |
| `OK` | Install + content setup + build (incl. real diagram prebuild) all green. |
| `BUILD_RED` | A smoke-test step exited nonzero. Report which step + error; **never** report success. |
| `SCHEMA_VIOLATION` | The assembled manifest broke a schema rule; reject before writing further. |
| `RERUN_SKIP` | A user-edited managed file was left untouched (never a hard fail). |
| `PARTIAL_EMISSION` | Emission failed partway; no rollback — flag the partial tree + failed step; recover via re-run. |
| `HARD_FAIL_IMPOSSIBLE` | No writable target tree, or a write/symlink would escape the repo root. |

## Further reading

- [README](./README.md) — overview, quick start, when (not) to use it
- [Architecture](./architecture.md) — the pipeline, emission model, manifest triad, never-clobber, vendoring, safety
