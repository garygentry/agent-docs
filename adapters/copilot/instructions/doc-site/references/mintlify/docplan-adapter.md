# Consuming a DocPlan — the Mintlify nav adapter (agent reference)

The Mintlify analogue of `../content-plan.md`. When a **DocPlan** (authored by
`content-architect`) is present, translate its `grouping` + `documents` into the
`docs.json` **`navigation`** object and seed mode-pure native page stubs — instead of guessing
the nav during the interview.

This shares the DocPlan **discovery + validation** step with the Starlight adapter (see
`../content-plan.md §1` — same lookup paths, same `ajv-cli` validation, same
`SCHEMA_VIOLATION`-falls-back-to-interview rule). Only the **output shape** differs, and it
maps **more directly** than Starlight's: DocPlan `grouping` is an explicit ordered section list,
and so is Mintlify `navigation.groups` — no slug-first-segment normalization is needed.

---

## 1. Why the mapping is direct

| DocPlan                                  | `docs.json navigation`                                             |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `grouping[]` — explicit ordered sections | `navigation.groups[]` — explicit ordered groups (1:1)              |
| `grouping[].title`                       | `group` (verbatim, sentence-case preserved)                        |
| `grouping[].documents` (ordered ids)     | `pages: ["<path>", …]` (ordered, 1:1)                              |
| `DocPlanEntry.slug`/`path`               | page path — root-relative, **no extension, no leading slash**      |
| `DocPlanEntry.type` (mode)               | selects the **stub template** (no nav field)                       |
| `scope: both` / multiple `audiences`     | `navigation.tabs[]` — **Mintlify-unique** (see §3)                 |
| `sources[]` of `type: api` (+ `apiDocs`) | a group/tab with `"openapi"` — **Mintlify-unique** (`api-docs.md`) |

Unlike Starlight (`content-plan.md §2`), there is **no shape mismatch to reconcile** — Mintlify
groups are explicit, so DocPlan sections become groups directly and order is preserved with no
slug rewriting.

## 2. The mapping algorithm (deterministic; groups form)

For `scope ∈ {end-user, architecture}` (single spine), emit `navigation.groups`:

1. Iterate `grouping` in array order (= group order). For each section, emit
   `{ "group": section.title, "pages": [...] }`.
2. Iterate `section.documents` (ordered ids) in order (= page order within the group). For each
   id, resolve the entry from `documents[]` and compute its **page path**:
   - `entry.slug` if set, else `slugify(entry.path without extension)`, else `slugify(entry.id)`.
   - Normalize to Mintlify form: POSIX, **no** extension, **no** leading slash (e.g.
     `guides/setup`). A single-segment path (`get-started`) is a top-level page in the group —
     Mintlify groups are explicit, so no prefix rewrite is needed (contrast Starlight).
   - **Path collision** within the nav → append `-2`, `-3`, … and record an assumption.
3. Emit one `source: "native"` stub per page (§4).

Preserve DocPlan order end-to-end: **grouping order → group order**, **`section.documents`
order → page order**. Do **not** sort by `priority` (advisory staging rank, not IA order).

### Worked example

Grouping `[{ "Getting started": ["d1"] }, { "Reference": ["d2"] }]`, `d1` slug `get-started`,
`d2` slug `reference/client`:

```jsonc
"navigation": {
  "groups": [
    { "group": "Getting started", "pages": ["get-started"] },
    { "group": "Reference",       "pages": ["reference/client"] }
  ]
}
```

`d1`'s single-segment `get-started` stays a top-level page **inside** the "Getting started"
group — no `getting-started/` prefix rewrite (the Starlight adapter needs one; Mintlify does
not, because the group is explicit).

## 3. `scope: both` / audiences → tabs (Mintlify-unique)

When the DocPlan `scope` is `both` (or `scopeTabs` is on / there are ≥2 audiences), render
**tabs** instead of a flat group list — a structure Starlight's sidebar cannot express:

```jsonc
"navigation": {
  "tabs": [
    { "tab": "Documentation", "groups": [ /* the end-user Diátaxis groups */ ] },
    { "tab": "Architecture",  "groups": [ /* the architecture groups */ ] }
  ]
}
```

Split `grouping` by the family/scope of the documents each section contains (`family: diataxis`
→ Documentation tab; `family: architecture` → Architecture tab). Within each tab, apply §2.
When `scope` is single, emit the flat `groups` form (§2) — do not force an unnecessary tab.

## 4. Mode-pure page stubs

Each derived page is `source: "native"`, so author a stub at `{{DOCS_PKG_DIR}}/<path>.mdx`. Seed
the body from the **same** `content-architect` mode template the Starlight adapter uses — reuse
by fixed relative path, never copy (`../content-plan.md §5` table): `../../content-architect/
references/templates/<type>.md` for `tutorial|how-to|reference|explanation|adr|arc42-chapter`
(`c4-view` → minimal reference-style stub).

Give each stub **Mintlify** frontmatter (not Starlight's), with these keys:

- `title` — from `entry.title` (required).
- `description` — from `entry.purpose`.
- `icon` (optional) — mapped by `type`: tutorial→`graduation-cap`, how-to→`wrench`,
  reference→`book`, explanation→`lightbulb`, adr→`file-text`.
- `mode: wide` (optional) — for reference pages only.

Keep the body **mode-pure** (one `type` per document — the DocPlan guarantees this), leave the
`entry.outline[]` headings as scaffolding, and **never assert anything the DocPlan recorded in
`gaps[]`**.

## 5. Home-link reconciliation

When a DocPlan drives the nav, the default `guides/setup` seed is **not** part of the plan:

- **Suppress** the default `guides/setup` stub.
- **Retarget** the `index.mdx` `<Card href="…">` links to the **first DocPlan page** (first
  document of the first section), in Mintlify link form (root-relative, no extension, no trailing
  slash, e.g. `/getting-started/get-started`).
- Add `index` as the first entry of the first group in `navigation` if you want the landing in
  the sidebar (optional — Mintlify treats `index` as the site root either way).

## 6. Validation

- Validate the assembled `docs.json` structurally before writing further (`docs-json.md
§validate`): every nav page path resolves to a file that will exist, no duplicate paths, nav
  well-formed. A violation is a `SCHEMA_VIOLATION`: reject before writing.
- Native stubs are not hash-tracked (user-owned; `rerun.md §2`); `docs.json` is
  managed-but-merged.
- `mint validate` (Phase 6, `verify.md`) is the authoritative end-to-end check.
