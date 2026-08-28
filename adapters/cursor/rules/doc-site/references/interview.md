# interview.md — Phase 2: interview

This is the agent-facing procedure for **Phase 2 (interview)** of the `doc-site`
skill. It fills every substitution token (`00 §4.1`) and the component-selection
record (`00 §5`).

The interview is **conversational and agent-driven**. The exact phrasing you use to ask each
question is up to you (out of scope for byte-identity, REQ-PORT-02); what is fixed is the set
of parameters captured, their detection-seeded defaults, and the token / selection-record
field each one fills.

Each question carries a **suggested default seeded from Phase 1 detection** (`detect.md`);
the user accepts or overrides. Because every parameter has a non-detection default, the
interview alone is sufficient to fill all parameters even with **zero** detection signals
(REQ-INT-02) — detection strictly improves defaults, it is never a gate.

## Question 0 — renderer (asked first; gates the rest)

Before the identity questions, ask which documentation **renderer** to scaffold:

- **`starlight`** (default) — Astro 5/6 + Starlight static site. The historical behavior;
  unchanged.
- **`mintlify`** — a Mintlify site (`docs.json` + MDX). Forks emit/verify/deploy per
  `references/mintlify/*`.
- **`both`** — one shared content source rendered by _both_ containers (the power path;
  `references/mintlify/content-sourcing.md`).

Seed the default from **Probe 8** (`detect.md`): an existing `docs.json`/`mint.json` ⇒
`mintlify`; an existing Starlight install ⇒ `starlight`; both ⇒ `both`; neither ⇒ `starlight`
(`ASSUME-RENDERER-STARLIGHT`). The answer fills the selection-record field `renderer` and
decides which of the parameters below apply:

| Parameter group                                          | `starlight`                             | `mintlify`                                                | `both`                            |
| -------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------- | --------------------------------- |
| Identity (1–3, 8) — title, description, social, docs dir | ✓                                       | ✓                                                         | ✓                                 |
| Content sourcing (4–5)                                   | ✓                                       | ✓                                                         | ✓ (into a shared `content/` root) |
| Title-frontmatter remediation (5a)                       | ✓ (Starlight `docsSchema()` hard-fails) | — (lighter check; no load-fail)                           | ✓ (for the Starlight container)   |
| Deploy (6) — GH Pages / Vercel / Netlify                 | ✓                                       | — (uses Mintlify deploy, `references/mintlify/deploy.md`) | ✓ (Starlight container only)      |
| Accent colors (7)                                        | ✓ (`--sl-*` CSS)                        | reused as `docs.json` `colors`                            | ✓ (both)                          |
| Mintlify params (M1–M3, below)                           | —                                       | ✓                                                         | ✓                                 |

## Mintlify-only parameters (asked when `renderer ∈ {mintlify, both}`)

| #   | Parameter           | Fills token / field                          | Default                                                                  |
| --- | ------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| M1  | Named theme         | `{{MINT_THEME}}` → `docs.json` `theme`       | `mint`                                                                   |
| M2  | Primary color       | `{{MINT_PRIMARY}}` (+ light/dark) → `colors` | derived from the accent answer (question 7)                              |
| M3  | API docs (OpenAPI)  | selection field `apiDocs`                    | **auto-offered** if Probe 8 found a spec; else declined                  |
| M4  | Scope/audience tabs | selection field `scopeTabs`                  | on when the DocPlan `scope` is `both` or has ≥2 audiences; else declined |

The **accent/brand color** (question 7) is asked once and rendered per renderer: Starlight
writes `{{ACCENT_LIGHT}}`/`{{ACCENT_DARK}}` into `custom.css`; Mintlify writes
`{{MINT_PRIMARY}}` + light/dark into `docs.json` `colors`. Do not ask twice.

## Minimum required parameter set (8 parameters, REQ-INT-01)

Capture, at minimum, all 8 of the following. Each maps to its token(s) / selection-record
field with a detection-seeded default. (These are the **identity + content** parameters shared
by every renderer; the renderer question above and the Mintlify params gate what else is asked.)

| #   | Parameter             | Fills token(s) / field                                      | Default (seeded from detection)                                             |
| --- | --------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Site title            | `{{SITE_TITLE}}`                                            | repo name from the Probe 7 slug, titlecased; else target dir name           |
| 2   | Site description      | `{{SITE_DESC}}`                                             | `Documentation for {{SITE_TITLE}}`                                          |
| 3   | Social links          | `{{GITHUB_URL}}` (+ `manifest.site.social`)                 | `https://github.com/{{REPO_SLUG}}` from Probe 7; else `""`                  |
| 4   | Content-sourcing mode | selection field `contentMode` (`symlink`/`native`/`mixed`)  | `symlink` if Probe 4 found docs; else `native` (`ASSUME-NO-DOCS`)           |
| 5   | Markdown→slug mapping | `manifest.pages[]` in `docs.manifest.json`                  | one `pages[]` entry per `docs/*.md` from Probe 4 (slug = filename sans ext) |
| 6   | Deploy target(s)      | selection field `deploy[]`; `{{SITE_URL}}`, `{{BASE_PATH}}` | `[]` (none) — opt-in                                                        |
| 7   | Accent colors / brand | `{{ACCENT_LIGHT}}`, `{{ACCENT_DARK}}`                       | canon default accents                                                       |
| 8   | Docs-package location | `{{DOCS_PKG_DIR}}`                                          | `packages/docs/` if monorepo (Probe 1); else `docs/`                        |

## Parameter → token / field mapping (detail)

Each answer maps mechanically onto a token or selection-record field. No answer is left
without a destination; no token in `00 §4.1` lacks a source.

**Site identity (questions 1–3):**

- Title → `{{SITE_TITLE}}` → core `astro.config.mjs` and `index.mdx`, and written to
  `manifest.site.title`.
- Description → `{{SITE_DESC}}` → `manifest.site.description`.
- Social: the GitHub URL → `{{GITHUB_URL}}` and `manifest.site.social.github`. Additional
  platforms the user adds become further `manifest.site.social` keys (Starlight social-icon
  names mapped to URLs).

**Content sourcing (questions 4–5):**

- Mode → selection field `contentMode`. Drives whether the `symlink/` template group is
  emitted.
- Mapping → `manifest.pages[]`, one entry per mapped markdown file, per the `PageEntry`
  contract (`00 §2.2`):
  - `symlink` page → `{ "slug": "<slug>", "source": "symlink", "from": "<repo-rel path>" }`
  - `native` page → `{ "slug": "<slug>", "source": "native" }`
  - In `mixed` mode the per-page `source` is chosen page-by-page. Propose slugs from
    filenames (Probe 4) and let the user rename. **Page order in the array is sidebar order.**

**Title frontmatter (question 5a — Starlight only; symlink/mixed only, when Probe 4's
frontmatter scan found docs missing `title:`):** This remediation exists because Starlight's
`docsSchema()` hard-fails the build on a missing `title:`. Under `renderer=mintlify` it does
**not** apply (Mintlify has no equivalent load-time schema fail; a missing `title` is a
`mint validate` warning, not a build-breaker) — keep a lighter advisory check instead. Under
`renderer=both`, apply it for the Starlight container. Starlight's `docsSchema()` **requires**
`title:` and
validates it at load (before remark), so a frontmatter-less symlinked page hard-fails the
build with `InvalidContentEntryDataError: title: Required`. The remediation is to **add a
`title:` frontmatter key to each source doc, derived from its first `# H1`** (fall back to
the slug's last segment if there is no H1).

This edits **committed source docs**, so **ask the user first** and show which files will
change. A site-only loader/remark shim is **not** a viable alternative: Starlight enforces
`title` inline in its content loader, and `docsSchema({ extend })` cannot relax it — both
were verified to still fail the build — so injecting the key into the source is the
reliable fix. (If the user truly cannot edit the source docs, the page must instead be
authored natively or marked `unmanaged`.)

**Deploy (question 6):**

- Chosen subset → `deploy[]` ⊆ `["github-pages","vercel","static-netlify"]`. Empty by default
  (opt-in).
- The chosen target(s) seed `{{SITE_URL}}` and `{{BASE_PATH}}`: GitHub Pages on a project
  subpath ⇒ `{{BASE_PATH}}` = `/<repo>/`, `{{SITE_URL}}` = `https://<owner>.github.io`;
  Vercel/static at root ⇒ `{{BASE_PATH}}` = `""`, `{{SITE_URL}}` = production URL. When no
  deploy target is chosen, both default to `""` (env-driven at build).

**Brand (question 7):**

- Light accent → `{{ACCENT_LIGHT}}`; dark accent → `{{ACCENT_DARK}}` → core `custom.css`.
  Defaults are the canon accents.

**Location (question 8):**

- Docs-package dir → `{{DOCS_PKG_DIR}}` → the path prefix every emitted plumbing file is
  written under.

**Detection-only tokens (not asked unless overridden):** `{{PKG_MANAGER}}`, `{{RUNTIME}}`,
`{{REPO_SLUG}}`, `{{DEFAULT_BRANCH}}` are seeded from detection and surfaced as **confirmable
assumptions** rather than open questions; the user may override any. `{{IMAGES_SRC_DIR}}` is
seeded from detection / interview (default `docs/images`, or `{{DOCS_PKG_DIR}}/images`) for
the symlink layer. `{{ASTRO_VERSION}}` / `{{STARLIGHT_VERSION}}` are resolved at scaffold
time, not interviewed (version policy in `rerun.md`). The derived tokens
`{{DOCS_PKG_DIR_TO_ROOT}}` and `{{SYMLINK_PAGE_LINES}}` are computed, not asked.

## Surfacing assumptions (REQ-USE-02)

Every assumption record from Phase 1 MUST reach the user at two points:

1. **At interview time** — when a question's default came from a fallback rather than a
   positive detection (e.g. `{{PKG_MANAGER}}` is `npm` because no lockfile was found), present
   the value as an assumption the user can confirm or override.
2. **In the final summary** — Phase 7 reprints the full list of assumption records, with each
   assumption's final resolved value, so even silently-confirmed assumptions stay visible.

## Optional components stay opt-in (REQ-USE-01)

The optional components — **diagrams** (`05`), additional **deploy** targets, and the
**drift guard** (`07`) — default to **declined** in the selection record (`diagrams=false`,
`deploy=[]`, `driftGuard=false`). Ask about them but never force them.

The selection record this phase produces:

```jsonc
{
  "renderer": "starlight" | "mintlify" | "both",   // from question 0 (default "starlight")
  "contentMode": "symlink" | "native" | "mixed",   // from question 4
  "diagrams": false,                                 // default declined
  "deploy": [],                                      // default declined (opt-in subset) — Starlight only
  "driftGuard": false,                               // default declined
  "monorepo": false,                                 // detection-seeded (Probe 1)

  // Mintlify-only fields (present iff renderer ∈ {mintlify, both}):
  "mintTheme": "mint",                               // from M1
  "apiDocs": false,                                  // from M3 (auto-offered when a spec is detected)
  "scopeTabs": false                                 // from M4
}
```

For `renderer=mintlify`, the Starlight-only optional fields (`deploy[]`, and the diagram
component's vendored-renderer variant) are inert; Mintlify uses its own deploy/verify/diagram
paths (`references/mintlify/*`). For `renderer=both`, both the Starlight and Mintlify fields
apply.

When the user declines every optional component and chooses `contentMode="native"`, the
selection record triggers the **decline-all invariant** (`00 §5`): only the core scaffold is
emitted. This phase's responsibility is solely to **capture** the choices; emission gating is
owned by the component docs.

## Undetected-parameter guarantee (REQ-INT-02)

For every signal detection could not resolve, the corresponding parameter is still reachable:
questions 1–8 each have a non-detection default, and the detection-only tokens fall back to
their `ASSUME-*` defaults presented as overridable assumptions. **No parameter requires a
successful detection.** A brand-new repo with no remote, no lockfile, and no `docs/` still
completes the interview to a full token set + selection record using only `ASSUME-*` defaults
plus user input.
