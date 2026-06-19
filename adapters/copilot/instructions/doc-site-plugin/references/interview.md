# interview.md — Phase 2: interview

This is the agent-facing procedure for **Phase 2 (interview)** of the `doc-site-plugin`
skill. It implements `specs/doc-site-plugin/02-detection-and-interview.md §4` and fills
every substitution token (`00 §4.1`) and the component-selection record (`00 §5`).

The interview is **conversational and agent-driven**. The exact phrasing you use to ask each
question is up to you (out of scope for byte-identity, REQ-PORT-02); what is fixed is the set
of parameters captured, their detection-seeded defaults, and the token / selection-record
field each one fills.

Each question carries a **suggested default seeded from Phase 1 detection** (`detect.md`);
the user accepts or overrides. Because every parameter has a non-detection default, the
interview alone is sufficient to fill all parameters even with **zero** detection signals
(REQ-INT-02) — detection strictly improves defaults, it is never a gate.

## Minimum required parameter set (8 parameters, REQ-INT-01)

Capture, at minimum, all 8 of the following. Each maps to its token(s) / selection-record
field with a detection-seeded default.

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
  "contentMode": "symlink" | "native" | "mixed",   // from question 4
  "diagrams": false,                                 // default declined
  "deploy": [],                                      // default declined (opt-in subset)
  "driftGuard": false,                               // default declined
  "monorepo": false                                  // detection-seeded (Probe 1)
}
```

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
