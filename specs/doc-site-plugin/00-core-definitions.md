# 00 — Core Definitions

The shared data contracts for `doc-site-plugin`. This feature is a **canonical
skill** (markdown orchestration + parameterized template assets), so its "type
system" is a set of **JSON data contracts** (the docs manifest, the provenance
manifest), a **substitution-token vocabulary**, a **component-selection model**,
and an **assumption / error taxonomy** — not TypeScript domain types. The only
TypeScript in this feature lives in the in-repo *verification* surface
(`src/test/**`, see `10-testing-strategy.md`); those types are defined here where
they are shared.

Every other document in this suite references the contracts defined here. Where a
later document needs a token, a manifest field, an exit code, or an assumption
code, it cites the canonical definition in this file rather than redefining it.

## Requirement Coverage

| REQ / decision ID | Requirement / decision                                       | Section |
| ----------------- | ------------------------------------------------------------ | ------- |
| REQ-CONTENT-01    | Three content-sourcing modes (symlink/native/mixed)          | §2, §5  |
| REQ-CONTENT-03    | Single canonical manifest drives sidebar/symlinker/drift     | §2      |
| REQ-CONTENT-04    | Each page entry records its source                           | §2      |
| OQ-2 (resolved)   | Manifest escape hatch = per-page `unmanaged: true`           | §2.3    |
| REQ-RERUN-01/02   | Provenance manifest distinguishes plumbing from user content | §3      |
| REQ-REL-02 / OQ-1 | Version resolution + pin contract recorded in provenance     | §3      |
| REQ-PORT-02       | `{{TOKEN}}` substitution vocabulary (byte-identical output)  | §4      |
| REQ-CORE-01/02/03 | Tokens feeding core scaffold (`SITE`/`BASE_PATH`, accents)   | §4      |
| REQ-USE-01        | Component-selection model (decline-all → zero files)         | §5      |
| REQ-DETECT-02     | Detection-signal model + fallback                            | §6      |
| REQ-USE-02        | Assumption record (every degraded default surfaced)          | §6      |
| REQ-VERIFY-02/04  | Generator error / partial-emission taxonomy                  | §7      |
| REQ-DIAG-03       | Vendored renderer exit-code contract (consumed)              | §8      |

## 1. Vocabulary & conventions

- **Generator** — the `doc-site-plugin` skill, driven conversationally by a coding
  agent in the engineer's repo (CON-03).
- **Target repo** — the repo the generator scaffolds *into* (distinct from
  `agent-docs`, the repo the skill is *authored* in).
- **Canon** — the reference Astro 5 + Starlight site described in
  `specs/doc-site-plugin/.reference/canon.md` (CON-04); the gold-master the emitted
  output must stay faithful to.
- **Template asset** — a literal `.tmpl` file under `references/templates/<component>/`
  whose body is copied verbatim into the target after `{{TOKEN}}` substitution.
- **Managed / plumbing file** — a generator-owned file tracked in the provenance
  manifest (§3) and subject to never-clobber on re-run.
- **Authored content page** — a `source: "native"` page; user-owned, never tracked
  for overwrite.
- All target-repo paths in this suite are **repo-relative POSIX paths**.
- JSON contracts are **strict** (`additionalProperties: false`) unless stated.

## 2. `docs.manifest.json` — the single source of truth (REQ-CONTENT-01/03/04)

The canonical manifest in the **target repo**. One file feeds three consumers —
sidebar generation (`03-core-site-and-manifest.md`), the symlinker
(`04-content-symlink-layer.md`), and the drift guard (`07-drift-guard.md`) — so
they cannot drift apart (REQ-CONTENT-03).

### 2.1 Shape

```jsonc
{
  "site": {
    "title": "My Project Docs",
    "description": "Documentation for My Project",
    "social": { "github": "https://github.com/acme/myproject" }
  },
  "pages": [
    { "slug": "intro",         "source": "symlink", "from": "docs/intro.md" },
    { "slug": "guides/setup",  "source": "native" },
    { "slug": "legacy",        "unmanaged": true }
  ]
}
```

### 2.2 Field contract

| Field                | Type                       | Required                      | Meaning |
| -------------------- | -------------------------- | ----------------------------- | ------- |
| `site.title`         | string (non-empty)         | yes                           | Starlight site title. |
| `site.description`   | string                     | yes                           | Site description / meta. |
| `site.social`        | object<string,string(uri)> | no                            | Starlight social links (e.g. `github`). Keys are Starlight social-icon names; values are URLs. |
| `pages`              | array<PageEntry>           | yes (may be empty)            | Ordered; order **is** sidebar order. |
| `pages[].slug`       | string                     | yes                           | Route slug, POSIX-style (`guides/setup`); unique across `pages`. |
| `pages[].source`     | `"symlink"` \| `"native"`  | required unless `unmanaged`   | Where the page body comes from (REQ-CONTENT-04). |
| `pages[].from`       | string (repo-rel path)     | required **iff** `source: "symlink"` | Repo-root markdown to symlink in. Forbidden otherwise. |
| `pages[].unmanaged`  | boolean (default `false`)  | no                            | Escape hatch (§2.3). When `true`, `source`/`from` are not required and the generator does not wire the page. |

**Validation rules** (enforced by `docs.manifest.schema.json`, §2.4):
1. `source: "symlink"` ⇒ `from` present and non-empty.
2. `source: "native"` ⇒ `from` absent.
3. `unmanaged: true` ⇒ `source`/`from` optional; page exempt from sidebar↔manifest
   parity only (§2.3).
4. `unmanaged` absent/false ⇒ `source` required.
5. `slug` values unique.
6. Strict: no `additionalProperties` at any level.

### 2.3 Escape hatch — `unmanaged: true` (OQ-2 resolved)

A page with `"unmanaged": true` is owned by the user, not the generator:
- The generator does **not** create its sidebar entry or symlink.
- The drift guard **exempts it from sidebar↔manifest parity** but **still applies**
  broken-internal-link and required-frontmatter checks (`07-drift-guard.md §3`).

This preserves the single-source guarantee for managed pages while allowing edge
cases (REQ-CONTENT-03).

### 2.4 `docs.manifest.schema.json` (hand-authored static asset)

A **hand-authored** JSON Schema (Draft 2020-12) shipped at
`references/docs.manifest.schema.json` and copied into the target repo. It is **not**
generated by `src/schema-gen.ts` (that module is hardwired to the `Manifest` Zod
source — see `09-integration-and-emission.md`); keeping it a static asset preserves
the "no `src/` emitter changes" property (tech-spec §3.4). It encodes every rule in
§2.2. It is validated in-repo by a vitest test that asserts it is a valid schema and
accepts/rejects fixtures (`10-testing-strategy.md`).

## 3. `.doc-site-scaffold.json` — provenance manifest (REQ-RERUN-01/02, REQ-REL-02)

Written into the **target repo** to distinguish generator-owned plumbing from
user-edited / authored content, enabling safe re-run (`08-rerun-and-verification.md`).

### 3.1 Shape

```jsonc
{
  "version": "1.0.0",            // scaffold-format version
  "diagramContract": "1.0.0",    // pinned diagram-render.mjs CONTRACT_VERSION (if diagrams emitted)
  "astroPin": "5.13.2",          // resolved Astro version written at first scaffold (REQ-REL-02)
  "starlightPin": "0.36.0",      // resolved Starlight version
  "files": {                     // managed plumbing files → sha256 of last-emitted content
    "docs/astro.config.mjs": "sha256:1f3a…",
    "setup-docs.sh": "sha256:9bc2…"
  }
}
```

### 3.2 Field contract

| Field             | Type                  | Required | Meaning |
| ----------------- | --------------------- | -------- | ------- |
| `version`         | semver string         | yes      | Scaffold-format version of the generator that wrote the tree. |
| `diagramContract` | semver string         | iff diagrams emitted | Pinned `CONTRACT_VERSION` of the vendored renderer (§8, REQ-DIAG-03). |
| `astroPin`        | semver-ish string     | yes      | Astro version resolved at **first** scaffold; preserved on re-run (REQ-RERUN-01, REQ-REL-02). |
| `starlightPin`    | semver-ish string     | yes      | Starlight version, same policy. |
| `files`           | object<path, sha256>  | yes      | Map of each managed plumbing file (repo-relative) to the sha256 of its last generator-emitted content. **Authored content pages (`source: native`) are never listed** (REQ-RERUN-02). |

### 3.3 Re-run decision table (drives `08-rerun-and-verification.md`)

| State of a managed file at re-run                 | Action                          |
| ------------------------------------------------- | ------------------------------- |
| Absent in tree                                    | (Re)emit.                       |
| Present, hash == recorded                         | Safe to regenerate (overwrite). |
| Present, hash != recorded (user-edited)           | **Skip + flag** (never clobber, OQ-3). |
| `source: native` page (not in `files`)            | Never tracked → always preserved. |

`sha256:` prefix is literal; the digest is lowercase hex of the file's UTF-8 bytes.

## 4. Substitution-token vocabulary (REQ-PORT-02)

Template assets contain `{{TOKEN}}` placeholders. The agent performs **plain string
replacement** of every `{{TOKEN}}` occurrence with an interview-derived value, then
writes the result — it never authors file content. This makes the emitted file set
a pure function of the interview answers, which is the keystone of REQ-PORT-02's
build-time equivalence bar.

**Rules:**
- Tokens are `UPPER_SNAKE`, delimited by `{{` `}}`, no spaces inside.
- Replacement is literal/global; no conditionals or loops inside templates.
  Component selection and monorepo-vs-single are expressed by **which template
  groups are emitted** and by named fragments, never by in-template logic
  (tech-spec §3.2).
- Every token used in `references/templates/**` MUST be defined in the canonical table
  below (and the SKILL.md substitution table), and vice-versa — enforced by the
  token-coverage test (`10-testing-strategy.md`).

### 4.1 Canonical token table

| Token               | Source (interview / detection)                 | Default                              | Used by |
| ------------------- | ---------------------------------------------- | ------------------------------------ | ------- |
| `{{SITE_TITLE}}`    | interview                                       | repo name (titlecased)               | core (`astro.config`, `index.mdx`) |
| `{{SITE_DESC}}`     | interview                                       | `"Documentation for {{SITE_TITLE}}"` | core |
| `{{SITE_URL}}`      | interview / deploy target                       | `""` (env-driven at build)           | core, deploy |
| `{{BASE_PATH}}`     | deploy target (GH Pages subpath vs root)        | `""`                                 | core, deploy |
| `{{REPO_SLUG}}`     | detection (`git remote`) / interview            | ask                                  | deploy (GH Pages), social |
| `{{GITHUB_URL}}`    | derived from `{{REPO_SLUG}}`                    | `""`                                 | core (social) |
| `{{PKG_MANAGER}}`   | detection (lockfile / `packageManager`)         | `npm`                                | core (`package.json`), deploy CI |
| `{{RUNTIME}}`       | detection (`bun.lock` / `engines.node`)         | `node`                               | deploy CI, scripts |
| `{{DOCS_PKG_DIR}}`  | interview                                        | `docs/` (single) / `packages/docs/` (monorepo) | all paths |
| `{{ACCENT_LIGHT}}`  | interview                                        | canon default light accent           | core (`custom.css`) |
| `{{ACCENT_DARK}}`   | interview                                        | canon default dark accent            | core (`custom.css`) |
| `{{DEFAULT_BRANCH}}`| detection (`git symbolic-ref`)                  | `main`                               | deploy (GH Pages triggers) |
| `{{ASTRO_VERSION}}` | resolution (latest @ first scaffold; pin on re-run) | latest                           | core (`package.json`) |
| `{{STARLIGHT_VERSION}}` | resolution                                  | latest                               | core (`package.json`) |
| `{{DOCS_PKG_DIR_TO_ROOT}}` | **derived** (relative hop from `{{DOCS_PKG_DIR}}` up to repo root, e.g. `../..`) | derived from `{{DOCS_PKG_DIR}}` | symlink (`setup-docs.sh`) |
| `{{SYMLINK_PAGE_LINES}}` | **derived/generated** (one `ln -sfn` block per `source: symlink` page, expanded from `docs.manifest.json`) | generated | symlink (`setup-docs.sh`) |

**Direct vs. derived tokens.** Most tokens are *direct* (a single interview/detection
value). Two are *derived/generated*: `{{DOCS_PKG_DIR_TO_ROOT}}` is a pure function of
`{{DOCS_PKG_DIR}}` (count path segments → that many `..`), and
`{{SYMLINK_PAGE_LINES}}` expands to a generated multi-line block from the manifest's
`source: symlink` pages (`04-content-symlink-layer.md §2.2`). Both are still subject
to the token-coverage test: they appear here and in SKILL.md, and after substitution
**no literal `{{…}}` may survive** in the emitted file.

Components add no new tokens beyond this table without also adding a row here and in
SKILL.md (token-coverage test, `10-testing-strategy.md`). Per-document sections that
introduce a token cite this table.

## 5. Component-selection model (REQ-USE-01)

The generator emits **component-gated** template groups. Selection is captured in
the interview (`02-detection-and-interview.md`) and expressed as a selection record:

```jsonc
{
  "contentMode": "symlink" | "native" | "mixed",   // REQ-CONTENT-01
  "diagrams": false,                                 // REQ-DIAG-01
  "deploy": ["github-pages", "vercel", "static-netlify"],  // subset, may be []
  "driftGuard": false,
  "monorepo": false                                  // detection-seeded
}
```

**Decline-all invariant (REQ-USE-01):** when `diagrams=false`, `deploy=[]`,
`driftGuard=false`, and `contentMode="native"`, the generator emits **only** the
core scaffold (`03-core-site-and-manifest.md`) — zero files for every declined
component, no dangling hooks, configs, or references. Each component is a
self-contained template group keyed by this record; nothing else references a
declined group. This invariant is asserted by a scaffold-output fixture
(`10-testing-strategy.md`).

## 6. Detection-signal & assumption model (REQ-DETECT-02, REQ-USE-02)

Detection is best-effort and reads **only** target-repo files (no network,
REQ-SEC-03). Each signal has a fallback; every applied fallback produces an
**assumption record** that MUST be surfaced to the user (REQ-USE-02).

### 6.1 Detection signals (full table in `02-detection-and-interview.md §2`)

| Signal               | Default when absent           | Assumption code         |
| -------------------- | ----------------------------- | ----------------------- |
| monorepo vs single   | single-package                | `ASSUME-MONOREPO-SINGLE`|
| package manager      | `npm`                         | `ASSUME-PKGMGR-NPM`     |
| runtime              | `node`                        | `ASSUME-RUNTIME-NODE`   |
| existing docs        | none → native-mode default    | `ASSUME-NO-DOCS`        |
| existing CI          | none → fresh workflow         | `ASSUME-NO-CI`          |
| default branch       | `main` (after asking)         | `ASSUME-BRANCH-MAIN`    |
| repo slug / remote   | ask user                      | `ASSUME-SLUG-ASKED`     |

### 6.2 Assumption record

```jsonc
{ "code": "ASSUME-PKGMGR-NPM", "signal": "package manager", "chose": "npm", "because": "no lockfile or packageManager field found" }
```

The generator collects all assumption records and prints them in its summary
(REQ-USE-02). They are advisory output, not persisted to the target tree.

## 7. Generator error / outcome taxonomy (REQ-VERIFY-02/04)

The generator is an agent procedure, not a binary; "errors" are **outcome states**
the agent must report rather than thrown exceptions. Canonical states:

| State                     | Trigger                                                        | Required behavior |
| ------------------------- | -------------------------------------------------------------- | ----------------- |
| `OK`                      | Emission + `setup-docs` + build smoke test all green           | Print next steps (REQ-VERIFY-03). |
| `HARD_FAIL_IMPOSSIBLE`    | Scaffolding genuinely impossible (no writable tree)            | Stop; report why. Only legitimate hard-fail (REQ-DETECT-02). |
| `BUILD_RED`               | Build smoke test fails (REQ-VERIFY-01)                         | Report failure + remediation; **never report success** (REQ-VERIFY-02). |
| `PARTIAL_EMISSION`        | Failure mid-emission after some files written (REQ-VERIFY-04)  | **No rollback**; flag partial state, name the failed step, advise re-run (recovers via never-clobber merge). |
| `SCHEMA_VIOLATION`        | `docs.manifest.json` fails schema before wiring               | Reject with the schema error before any file is written. |
| `RERUN_SKIP`              | A managed file diverged from provenance hash (§3.3)            | Skip + flag that file; continue with the rest. |

`PARTIAL_EMISSION` is intentionally distinct from the `diagram-generator` sibling's
per-artifact *no-partial-writes* guarantee, which applies only to that tool's own
single-artifact output (PRD REQ-VERIFY-04, tech-spec §7).

## 8. Consumed contract — vendored diagram renderer (REQ-DIAG-03)

The diagram component vendors `diagram-render.mjs` from the sibling
`diagram-generator` skill and invokes it per its **frozen v1.0.0 contract**. The
authoritative source is `specs/diagram-generator/05-cli-and-invocation.md`; the
fields this feature depends on are fixed here for reference (consumed, not defined):

```
node scripts/diagram-render.mjs <spec.json> \
  --type <architecture|flowchart|sequence|er|state|dataflow> \
  --theme <light|dark>            # no --theme both; invoke twice for both variants
  --accent '#rrggbb' \
  --format <svg|png|both> \
  --out-file <path>               # OR --out-dir <dir> --out-name <name>
# --version  -> prints CONTRACT_VERSION ("1.0.0"), exit 0
```

**Exit codes** (any nonzero ⇒ build failure, surfaced not masked — REQ-VERIFY-02):

| Code | Meaning |
| ---- | ------- |
| 0    | OK      |
| 2    | input/spec error |
| 3    | render error |
| 4    | output error |
| 5    | PNG error (may leave a written SVG when `--format both`) |
| 6    | IO error |
| 64   | usage error |

The pinned `CONTRACT_VERSION` is `1.0.0`; the generator verifies `--version`
matches before vendoring (`05-diagrams-component.md`).

## Dependencies

None — this is the root contract document. Every other document in this suite
depends on it.

## Verification

- `docs.manifest.schema.json` encodes every rule in §2.2; fixtures accept the §2.1
  shape and reject violations (`10-testing-strategy.md`).
- Every `{{TOKEN}}` in `references/templates/**` appears in §4.1 and SKILL.md, and
  vice-versa (token-coverage test).
- The provenance shape (§3.1) round-trips through the re-run decision table (§3.3)
  in `08-rerun-and-verification.md`.
- The consumed renderer contract (§8) matches
  `specs/diagram-generator/05-cli-and-invocation.md` exactly.
