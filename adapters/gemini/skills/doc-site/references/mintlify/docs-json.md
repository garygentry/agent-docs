# The `docs.json` contract (agent reference)

`docs.json` is the Mintlify analogue of `docs.manifest.json` **and** `astro.config.mjs`
combined — it is the whole site config. This file documents the subset `doc-site` emits and
how the `navigation` block is produced when **no** DocPlan drives the IA.

## Emitted shape (from `templates/mintlify/docs.json.tmpl`)

```jsonc
{
  "$schema": "https://mintlify.com/docs.json",
  "theme": "{{MINT_THEME}}",              // named theme: mint | maple | palm | willow | …
  "name": "{{SITE_TITLE}}",
  "description": "{{SITE_DESC}}",
  "colors": {
    "primary": "{{MINT_PRIMARY}}",        // hex; from the accent answer (interview Q7/M2)
    "light": "{{MINT_COLOR_LIGHT}}",
    "dark": "{{MINT_COLOR_DARK}}"
  },
  "favicon": "/favicon.svg",
  "navigation": {{MINT_NAVIGATION}},      // generated (adapter or interview) — see below
  "navbar": { "links": [{ "label": "GitHub", "href": "{{GITHUB_URL}}" }] },
  "footer": { "socials": { "github": "{{GITHUB_URL}}" } }
}
```

Required Mintlify keys are `theme`, `name`, `colors.primary`, `navigation`. `colors.light` /
`colors.dark` are derived tints of `{{MINT_PRIMARY}}` (a lighter and a darker shade); if you
cannot compute a tint, reuse `{{MINT_PRIMARY}}` for all three (still valid).

## `navigation` from the interview (no DocPlan)

When no DocPlan drives the IA, build `navigation.groups` from the interview's markdown→page
mapping (the Mintlify equivalent of Starlight's `pages[]`), preserving user order:

- Group pages by an interview-provided section, or by the first path segment when the user
  supplied multi-segment paths, or emit a single default group.
- Each page path is root-relative, **no extension, no leading slash** (`guides/setup`).
- The always-seeded landing (`index`) is the site root; the default `guides/setup` starter page
  is the Mintlify twin of Starlight's seed, so both `index` links resolve and `mint broken-links`
  stays green.

```jsonc
"navigation": {
  "groups": [
    { "group": "Guides", "pages": ["guides/setup"] }
  ]
}
```

When a DocPlan **is** present, `navigation` comes from `docplan-adapter.md` instead (groups or
tabs), and the default seed is suppressed.

## Page format (Mintlify)

- MDX/MD with YAML frontmatter; **`title` is required** on every page.
- Internal links: root-relative, **no extension, no trailing slash** (`/guides/setup`). This is
  the one convention that differs from Starlight (which uses a trailing slash). Never `../`
  relative links, never `.mdx` extensions.
- Components (`<Note>`, `<Steps>`, `<Columns>`, `<Card>`, `<Tabs>`, …) are **globally
  available** — do not `import` them.

## Managed-but-merged on re-run

`docs.json` is managed plumbing (hash-tracked, `rerun.md §1`) but reconciled **in place** like
`docs.manifest.json`: on re-run, regenerate the generated structure (`navigation`, colors, name)
without clobbering user-added `docs.json` keys (custom `navbar` links, `integrations`,
`redirects`, …). If the user edited `docs.json` (hash mismatch), it is `SKIP_FLAG`ged and the
on-disk file wins (`rerun.md §2.1`).

## Validate before wiring

Before writing further, structurally validate the assembled `docs.json`:

- every `navigation` page path resolves to a page file that will exist on disk;
- no duplicate page path across the nav;
- required keys present (`theme`, `name`, `colors.primary`, `navigation`).

A violation is a `SCHEMA_VIOLATION`: reject and write nothing further. The authoritative
end-to-end validation is `mint validate` at Phase 6 (`verify.md`); this pre-check keeps a broken
config from being written in the first place. Do **not** hand-author or vendor Mintlify's full
JSON schema — the hosted `$schema` reference + `mint validate` own it.
