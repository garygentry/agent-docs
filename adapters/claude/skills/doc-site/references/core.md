# Core Site Scaffold & Sidebar Generation (agent reference)

This reference covers two agent-run mechanics of the core site scaffold:

1. **Writing the manifest** (`docs.manifest.json` + `docs.manifest.schema.json`)
   into the docs package directory (`{{DOCS_PKG_DIR}}`).
2. **Generating the Starlight sidebar** deterministically from the manifest and
   substituting it into `astro.config.mjs`.

The manifest **field contract**, validation rules, and the `unmanaged` escape
hatch are documented in `manifest-schema.md` — this file references them, it does
not redefine them.

---

## 0. Core asset destinations

The `core/` template group emits into the docs package (`{{DOCS_PKG_DIR}}/`) at the
paths below. Most files sit at the package root; the asset and content files use
Astro's conventional `public/`, `src/styles/`, `src/content/` locations.

| Template asset           | Target path (under `{{DOCS_PKG_DIR}}/`)                              |
| ------------------------ | -------------------------------------------------------------------- |
| `package.json.tmpl`      | `package.json`                                                       |
| `tsconfig.json.tmpl`     | `tsconfig.json`                                                      |
| `.gitignore.tmpl`        | `.gitignore`                                                         |
| `astro.config.mjs.tmpl`  | `astro.config.mjs`                                                   |
| `content.config.ts.tmpl` | `src/content.config.ts` (Astro 5+ root location; builds on 5 and 6)  |
| `custom.css.tmpl`        | `src/styles/custom.css` (referenced by `astro.config.mjs`)           |
| `favicon.svg` (verbatim) | `public/favicon.svg` (Starlight's default `/favicon.svg`)            |
| `index.mdx.tmpl`         | `src/content/docs/index.mdx` (home splash)                           |
| `starter-page.mdx.tmpl`  | `src/content/docs/guides/setup.mdx` (the seeded `guides/setup` page) |

The two manifest files (§1) also land in `{{DOCS_PKG_DIR}}/`.

---

## 1. Writing the manifest into the docs package

This phase writes **two files**, and both land **inside** the docs package
directory (`{{DOCS_PKG_DIR}}`) — beside the consumers that read them.

| File                        | Target path                                  | Source                                                                          | Role                                      |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------- |
| `docs.manifest.json`        | `{{DOCS_PKG_DIR}}/docs.manifest.json`        | authored by the agent from the interview answers                                | the single source of truth                |
| `docs.manifest.schema.json` | `{{DOCS_PKG_DIR}}/docs.manifest.schema.json` | copied **verbatim** from the skill asset `references/docs.manifest.schema.json` | validates the manifest in the target repo |

### Why both live in the docs package

The **drift guard** is the only runtime consumer, and it resolves the manifest
relative to its own location — `check-docs.mjs` reads
`join(DOCS_PKG_DIR, "docs.manifest.json")`. The sidebar generation and the
symlinker consume the manifest at **emit time** (the agent reads the interview
answers, not a file on disk in the target). Placing both files in
`{{DOCS_PKG_DIR}}` puts the manifest beside its only runtime reader, so the guard
works out of the box in single-package **and** monorepo layouts (it never has to
know where the repo root is). The schema sits beside the manifest so the relative
`$schema` reference resolves locally.

### Managed-state of each file

- `docs.manifest.schema.json` is **managed plumbing** (hash-tracked for
  never-clobber). It is a hand-authored static asset, copied byte-for-byte; it is
  **not** generated. See `manifest-schema.md`.
- `docs.manifest.json` is **managed-but-merged** on re-run: the generator updates
  generated structure in place without clobbering user-added page entries.

### The `$schema` reference

The authored manifest carries a `$schema` reference so editors validate it
locally:

```jsonc
{
  "$schema": "./docs.manifest.schema.json",
  "site": {
    "title": "{{SITE_TITLE}}",
    "description": "{{SITE_DESC}}",
    "social": { "github": "{{GITHUB_URL}}" },
  },
  "pages": [
    /* see below */
  ],
}
```

### Default seed: the `guides/setup` starter page (all modes)

The `starter-page.mdx` core asset is **always emitted** to
`src/content/docs/guides/setup.mdx`, and the home splash (`index.mdx`) links to it
from two places: the **hero action** uses the relative `guides/setup/` (frontmatter is
not base-prefixed — see `symlink.md` §"Internal links"), while the **body card** uses
the root-absolute `/guides/setup/`. So the manifest **always seeds** the matching native
page entry — in **every** content mode, not just native — so both links resolve and the
drift guard's `broken-link` rule does not fire on a missing target:

```jsonc
"pages": [
  { "slug": "guides/setup", "source": "native" }
]
```

In **native** mode (no repo docs) this is the whole seed. In **symlink / mixed**
mode the interview maps each repo markdown file to a slug — producing
`{ "slug": "...", "source": "symlink", "from": "docs/..." }` entries — **in
addition to** the always-present `guides/setup` page. **Page order in the array is
sidebar order** — the sidebar algorithm below relies on this.

### Validate before wiring

**Before writing any sidebar or wiring,** validate the assembled manifest against
`docs.manifest.schema.json`. A violation is a `SCHEMA_VIOLATION`: reject with the
schema error and **write nothing further** (the sidebar cannot be generated
without a valid manifest). A `from` on a `native` page, or a missing `from` on a
`symlink` page, are caught by the schema and surfaced as `SCHEMA_VIOLATION` —
never silently fixed.

**Slug-uniqueness is NOT in the schema** (JSON Schema can't express
"unique property across array items"). Pre-check it yourself at emit time: if any
two pages share a `slug`, reject before wiring — duplicate slugs are otherwise
caught at check time by the drift guard's `duplicate-slug` rule (exit 2,
`drift-guard.md §2`).

**Determinism (byte-stable manifest).** Emit `docs.manifest.json` with a fixed key
order so re-runs are byte-identical (rerun.md §3): top level `$schema`, `site`,
`pages`; `site` as `title`, `description`, then `social` (omit when absent); each
page as `slug`, then `source`, `from`, `unmanaged` (omit absent keys). Pretty-print
with 2-space indent and a trailing newline.

---

## 2. Sidebar-from-manifest derivation (build time)

The Starlight `sidebar` is **derived from `docs.manifest.json` at build time** —
never serialized into `astro.config.mjs` and never hand-kept in parallel. This is
the single most important mechanic of the core scaffold: one source, cannot drift.

The emitted `astro.config.mjs` reads the manifest beside it and maps it through a
vendored, dependency-free helper (`core/sidebar.mjs`, §2.3):

```js
import { readFileSync } from "node:fs";
import { buildSidebar } from "./sidebar.mjs";

const manifest = JSON.parse(
  readFileSync(new URL("./docs.manifest.json", import.meta.url), "utf8"),
);
// …
sidebar: buildSidebar(manifest.pages),
```

Because the array is computed every build from the manifest, there is **no parallel
literal to keep in sync** — the old `// <<SIDEBAR>>` emit-time substitution and the
drift guard's `sidebar-parity` rule are both retired (#34). Adding a page is a
one-line manifest edit; the sidebar follows automatically on the next build.

### 2.1 Input → output

- **Input:** the ordered `pages` array from `docs.manifest.json`. **Manifest order
  IS sidebar order.**
- **Output:** the Starlight `sidebar` array, returned by `buildSidebar(pages)` at
  build time. Each leaf entry has the shape `{ label, slug }`; each group has the
  shape `{ label, items: [...] }`.

### 2.2 The algorithm

Iterate `pages` in manifest order:

1. **Skip** any page with `unmanaged: true` (the generator owns no sidebar entry
   for it).
2. Split the `slug` by the POSIX separator `/`.
3. A **single-segment** slug becomes a top-level leaf: `{ label, slug }`, where
   `label` is the page's optional `label` override, else the titleized last segment.
4. A **multi-segment** slug is **grouped** by the **first** path segment into a
   `{ label, items: [...] }` group. The **first occurrence** of a group fixes that
   group's order in the array and its label (the page's optional `group` override,
   else the titleized first segment); later pages with the same first segment append
   to the existing group's `items`.

The optional per-page `label` / `group` fields (manifest-schema.md) only override
the displayed text — they default to the titleized segments, so a manifest that
omits them yields the historical labels unchanged.

**`source` does not affect the sidebar.** A `native` page and a `symlink` page
with the same slug yield the **identical** `{ label, slug }` leaf. `source` only
governs how a page's body reaches `src/content/docs/` (the symlinker materializes
`symlink` pages; native pages are authored files). Only `unmanaged` excludes a
page from the sidebar. This is what makes mixed mode fully expressible through one
manifest.

**The home splash (`index.mdx`) is not a manifest page** and is excluded from
sidebar generation — it is the implicit route root `/`, not a sidebar entry.

`titleize` splits a segment on `-`, capitalizes each word, and joins with a single
space (e.g. `getting-started` → `Getting Started`).

### 2.3 The vendored `sidebar.mjs`

`buildSidebar` is emitted verbatim as the managed plumbing file `sidebar.mjs`
(template `core/sidebar.mjs.tmpl`) beside `astro.config.mjs`, which imports it. It
is a pure function of `pages` (no I/O, no deps), so it is byte-identical across
agents and runs the same at build time as it once did at emit time. The shipped
module is plain JS; the typed reference below is equivalent:

```ts
interface PageEntry {
  slug: string; // POSIX, e.g. "guides/setup"
  label?: string; // optional leaf-label override (defaults to titleized last segment)
  group?: string; // optional group-label override (defaults to titleized first segment)
  source?: "symlink" | "native";
  from?: string; // present iff source === "symlink"
  unmanaged?: boolean; // escape hatch
}
type SidebarLeaf = { label: string; slug: string };
type SidebarGroup = { label: string; items: SidebarEntry[]; collapsed?: boolean };
type SidebarEntry = SidebarLeaf | SidebarGroup;

/**
 * Build the Starlight sidebar array from manifest pages, preserving manifest
 * order (= sidebar order). Pages are grouped by their slug's first POSIX path
 * segment; single-segment slugs become top-level leaves. The home splash
 * (index) is never included; unmanaged pages are skipped.
 */
function buildSidebar(pages: PageEntry[]): SidebarEntry[] {
  const result: SidebarEntry[] = [];
  const groupIndex = new Map<string, SidebarGroup>(); // first slug segment → group node

  for (const page of pages) {
    // source (symlink vs native) does NOT affect the sidebar — both render
    // identically. Only `unmanaged` excludes a page.
    if (page.unmanaged) continue;

    const segments = page.slug.split("/");
    const leaf: SidebarLeaf = { label: page.label ?? titleize(last(segments)), slug: page.slug };

    if (segments.length === 1) {
      result.push(leaf); // top-level page
      continue;
    }
    const key = segments[0]; // group by first segment; label is overridable
    let group = groupIndex.get(key);
    if (!group) {
      group = { label: page.group ?? titleize(key), items: [] };
      groupIndex.set(key, group);
      result.push(group); // first occurrence fixes order + label
    }
    group.items.push(leaf);
  }
  return result;
}

/** "getting-started" → "Getting Started". */
function titleize(segment: string): string {
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
const last = <T>(a: T[]): T => a[a.length - 1];
```

### 2.4 Worked example

Manifest `pages` (in order):

```jsonc
[
  { "slug": "intro", "source": "symlink", "from": "docs/intro.md" },
  { "slug": "guides/setup", "source": "native" },
  { "slug": "guides/recovery", "source": "symlink", "from": "docs/recovery.md" },
  { "slug": "reference/cli", "source": "native" },
  { "slug": "legacy", "unmanaged": true },
]
```

produces the `sidebar` array `buildSidebar` returns at build time:

```js
sidebar: [
  { label: "Intro", slug: "intro" },
  {
    label: "Guides",
    items: [
      { label: "Setup", slug: "guides/setup" },
      { label: "Recovery", slug: "guides/recovery" },
    ],
  },
  {
    label: "Reference",
    items: [{ label: "Cli", slug: "reference/cli" }],
  },
  // `legacy` omitted — unmanaged
],
```

Note that `intro` (symlink) and `guides/setup` (native) render the same way —
`source` is invisible to the sidebar. `legacy` is absent because it is
`unmanaged`.

### 2.5 Re-run behavior

The sidebar is no longer materialized into `astro.config.mjs`, so there is nothing
to re-substitute on re-run: both `astro.config.mjs` and `sidebar.mjs` are static
managed plumbing whose bytes do not depend on the manifest. They follow the normal
never-clobber decision table (rerun.md §2) — an unchanged template is a no-op diff;
a user-edited file (on-disk hash ≠ recorded provenance hash) is `RERUN_SKIP`ped and
flagged. Manifest edits take effect at the **next build**, with no scaffold re-run
required — that is the whole point of build-time derivation (#34).
