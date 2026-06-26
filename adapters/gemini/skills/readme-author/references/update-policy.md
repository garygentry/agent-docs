# README update policy (agent reference)

How to restructure an existing README to the canonical skeleton without losing
substantive content or silently rewriting the author's voice.

The stance is **propose, don't clobber**: restructure the scaffolding, preserve the
substance, and surface anything you drop or flag.

## 1. Parse before you touch

Read the existing README in full and classify every section into one bucket:

- **Keep** — substantive, accurate content (real usage examples, API notes, config
  tables, project-specific caveats). Preserve it close to verbatim.
- **Merge** — content that belongs under a canonical heading but is mislabeled or
  scattered. Move it into the right `structure.md` slot; combine duplicates.
- **Restructure** — reorder sections into the canonical order; fix heading levels and
  the hero (`header-style.md`).
- **Flag** — content that looks stale, wrong, or unverifiable (a dead badge, a version
  that no longer matches `package.json`, a broken link, an example that won't run).
  Don't silently delete it — call it out and ask.

## 2. Restructure to the canonical skeleton

Map the kept and merged content onto the canonical order from `structure.md`, using the
project-type variant detected in SKILL Phase 1.
Add only the **essential** missing sections (hero, lede, install, quickstart, license).
Do not invent content for optional sections you have no information for — ask instead.

## 3. Preserve voice and substance

- Keep the author's wording for prose that already reads well; align it to the house
  style (one sentence per line, sentence-case headings) without rewriting its meaning.
- Never drop a working code example to "clean up" — port it into the quickstart/API slot.
- Keep project-specific caveats and gotchas; these are the highest-value lines in a README.

## 4. Propose, then apply

Prefer `Edit` over a wholesale `Write` so the change is reviewable as a diff.
For a large restructure, summarize the moves first (what's reordered, what's added, what's
flagged), then apply.
Surface every flagged item and every dropped line so the user can veto.
