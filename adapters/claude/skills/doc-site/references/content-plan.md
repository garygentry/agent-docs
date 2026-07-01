# Consuming a DocPlan — the content-plan adapter (agent reference)

`doc-site` can source its **information architecture** from a **DocPlan** authored by the
`content-architect` skill, instead of guessing the sidebar during the interview. When a
DocPlan is present (or the user asks for one), you translate its `grouping` + `documents`
into `docs.manifest.json` `pages[]` and seed mode-pure native stubs for each page.

This is the seam between the two skills: `content-architect` decides **what** documents
exist, **for whom**, and **how they group**; `doc-site` renders the container. See the
DocPlan contract in `../../content-architect/references/docplan.schema.json`.

---

## 1. When this applies

Run this step **after Phase 1 (detect)** and **before Phase 2 (interview)**:

1. Look for a DocPlan at `{{DOCS_PKG_DIR}}/docplan.json`, else `docs/docplan.json`, else the
   repo root `docplan.json`.
2. If none exists and the user wants a planned site, **invoke `content-architect`** (Skill
   tool, or point them at it) to author one, then continue here. `content-architect` writes
   `docs/docplan.json` + a self-validating `docplan.schema.json` beside it.
3. If a DocPlan is found, validate it before consuming:

   ```bash
   npx --yes ajv-cli@5 validate --spec=draft2020 \
     -s <dir>/docplan.schema.json -d <dir>/docplan.json
   ```

   A DocPlan that fails validation is a `SCHEMA_VIOLATION` on the **input** — report it and
   fall back to the normal interview rather than consuming a malformed plan.

When a DocPlan drives the IA, it **replaces** the interview's markdown→slug mapping: the
DocPlan's `grouping`/`documents` are authoritative for `pages[]`. The interview still
collects site-level parameters (title, description, social, accent, deploy, docs-package
dir) that the DocPlan does not carry.

---

## 2. Why an adapter is needed (shape mismatch)

The two contracts do **not** map 1:1, so a small, deterministic adapter is required:

| DocPlan                                             | `docs.manifest.json`                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------ |
| `grouping[]` — an **explicit** ordered section list | groups are **implicit**, derived from each slug's 1st segment (`core.md §2.2`) |
| `grouping[].title` — section label                  | `PageEntry.group` — a group-**label** override only                            |
| `DocPlanEntry.slug`/`path` — may be single-segment  | a single-segment slug renders as a **top-level leaf**, never inside a group    |
| `DocPlanEntry.title`                                | `PageEntry.label` — leaf-label override                                        |
| `DocPlanEntry.type` (mode)                          | no manifest field — drives which **stub template** seeds the page body         |

The load-bearing consequence: `buildSidebar()` groups pages by their **slug first-segment**,
not by any explicit list. A DocPlan section whose documents have single-segment or
inconsistent slugs (e.g. the example plan's "Getting started" → `get-started`) would **not**
reproduce the intended grouping. The adapter fixes this by normalizing slugs so every
document in a section shares a section-derived first segment.

---

## 3. The mapping algorithm (deterministic)

Iterate `grouping` in array order (= sidebar group order). For each section:

1. `groupSeg = slugify(section.title)` — lowercase, spaces→`-`, drop non-`[a-z0-9-]`. This is
   the slug first-segment that binds every page in the section into one sidebar group.
   - **Collision:** if `groupSeg` was already used by an earlier section, append `-2`, `-3`,
     … until unique. Record the reconciliation in the assumption log.
2. Iterate `section.documents` (the ordered `DocPlanEntry` ids) **in order** (= sidebar
   order within the group). For each id, resolve the entry from `documents[]` and emit one
   `PageEntry`:
   - **Base slug** = `entry.slug` if set, else `slugify(entry.path without extension)`, else
     `slugify(entry.id)`.
   - **Final slug:** if the base slug's first segment already equals `groupSeg`, keep it;
     otherwise rewrite to `groupSeg/<last-segment-of-baseSlug>`. Every emitted page is thus
     multi-segment and lands in the section's group.
     - **Leaf-slug collision** within a group → append `-2`, `-3`, … to the last segment.
   - `label` = `entry.title` (leaf-label override; preserves the DocPlan's exact wording).
   - `group` = `section.title` **on the first page of the group only** — `buildSidebar` takes
     the first occurrence and uses the exact string (no titleizing), so the sidebar group
     label matches the DocPlan section title verbatim. Omit `group` on the remaining pages.
   - `source` = `"native"` (a fresh authored stub; see §5).

Preserve DocPlan order end-to-end: **grouping order → sidebar group order**, and
**`section.documents` order → order within the group**. Do not sort by `priority` (it is an
advisory rank for staging output, not IA order).

### Worked example (`end-user.docplan.json`)

Grouping `[{ "Getting started": ["d1"] }, { "Reference": ["d2"] }]`, with `d1` slug
`get-started` and `d2` slug `reference/client`, yields:

```jsonc
"pages": [
  { "slug": "getting-started/get-started", "label": "Get started", "group": "Getting started", "source": "native" },
  { "slug": "reference/client",            "label": "Client API reference", "group": "Reference", "source": "native" }
]
```

`d1`'s single-segment `get-started` is rewritten under `getting-started/` so the "Getting
started" section becomes a real sidebar group. `d2`'s slug already starts with `reference`,
so it is kept as-is. `buildSidebar` (`core.md §2.4`) then produces exactly:

```js
sidebar: [
  {
    label: "Getting started",
    items: [{ label: "Get started", slug: "getting-started/get-started" }],
  },
  { label: "Reference", items: [{ label: "Client API reference", slug: "reference/client" }] },
];
```

— sidebar order and group labels match the DocPlan `grouping` exactly.

---

## 4. Starter-seed reconciliation (home links)

Normally `doc-site` always seeds a `guides/setup` native page and the home splash
(`index.mdx`) links to it (`core.md §"Default seed"`). When a DocPlan drives the IA, that
default page is **not** part of the plan, so:

- **Suppress** the default `{ "slug": "guides/setup", "source": "native" }` seed entry — do
  **not** add it to `pages[]`. The DocPlan-derived pages are the whole `pages[]`.
- **Retarget the home links** in `index.mdx` to the **first DocPlan page** (the first
  document of the first `grouping` section). Both link sites must point at it:
  - hero action `link:` — **relative**, e.g. `getting-started/get-started/` (no leading `/`;
    frontmatter is not base-prefixed — see `symlink.md`).
  - body card link — **root-absolute**, e.g. `/getting-started/get-started/`.

  `index.mdx` is authored content (the home splash, not a manifest page), so retargeting its
  two link tokens is a documented authoring adaptation, not a plumbing change.

- The `guides/setup.mdx` starter file is likewise **not** emitted in content-plan mode (its
  only purpose was to back the default seed).

This keeps `pages[]` — and therefore the sidebar — an exact image of the DocPlan `grouping`,
with no stray `Guides` group, while preserving doc-site's invariant that every home link
resolves and the drift guard's `broken-link` rule stays green.

---

## 5. Mode-pure page stubs

Each derived page is `source: "native"`, so `doc-site` authors a stub at
`src/content/docs/<slug>.mdx`. Seed the body from the matching `content-architect` template
by the entry's `type`:

| `DocPlanEntry.type` | Stub template (relative to this skill)                                      |
| ------------------- | --------------------------------------------------------------------------- |
| `tutorial`          | `../../content-architect/references/templates/tutorial.md`                  |
| `how-to`            | `../../content-architect/references/templates/how-to.md`                    |
| `reference`         | `../../content-architect/references/templates/reference.md`                 |
| `explanation`       | `../../content-architect/references/templates/explanation.md`               |
| `adr`               | `../../content-architect/references/templates/adr.md`                       |
| `arc42-chapter`     | `../../content-architect/references/templates/arc42-chapter.md`             |
| `c4-view`           | _(no dedicated template)_ — seed a minimal reference-style stub and note it |

Reuse the sibling skill's templates by fixed relative path — do **not** copy their content
into `doc-site`. Give each stub the required Starlight frontmatter (`title` from
`entry.title`; `description` from `entry.purpose`), keep the body **mode-pure** (one `type`
per document — the DocPlan already guarantees this), and leave the outline headings from
`entry.outline[]` as section scaffolding for the author to fill. Do not assert anything the
DocPlan recorded in `gaps[]`.

---

## 6. Never-clobber & validation

- Native authored stubs (`source: native`) are **not** hash-tracked — the user owns them
  after first write; a re-run never clobbers an edited stub (`rerun.md §2`).
- Managed plumbing (`sidebar.mjs`, `astro.config.mjs`, the schema copy) is unchanged by this
  path — it is still hash-tracked as normal.
- **Validate the assembled `docs.manifest.json`** against `docs.manifest.schema.json` before
  wiring, exactly as in `core.md §"Validate before wiring"`, and pre-check slug-uniqueness
  (the normalization in §3 must not produce a duplicate slug). A violation is a
  `SCHEMA_VIOLATION`: reject before writing further.
- Emit the manifest with the byte-stable key order from `core.md §"Determinism"`.

The net effect: the emitted `docs.manifest.json` sidebar order and groups are a faithful
image of the DocPlan `grouping`, with mode-pure stubs, and the build smoke test (Phase 6)
still passes.
