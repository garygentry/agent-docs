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
`src/content/docs/guides/setup.mdx`, and the home splash (`index.mdx`) hard-links to
`guides/setup/`. So the manifest **always seeds** the matching native page entry —
in **every** content mode, not just native — so the hero link resolves and the
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
without a valid manifest). Duplicate slugs, a `from` on a `native` page, or a
missing `from` on a `symlink` page are all caught by the schema and surfaced as
`SCHEMA_VIOLATION` — never silently fixed.

---

## 2. Sidebar-from-manifest algorithm

The Starlight `sidebar` array in `astro.config.mjs` is **generated from
`docs.manifest.json`** — never hand-kept in parallel. This is the single most
important mechanic of the core scaffold: one source, cannot drift.

### 2.1 Input → output

- **Input:** the ordered `pages` array from `docs.manifest.json`. **Manifest order
  IS sidebar order.**
- **Output:** a Starlight `sidebar` array literal, substituted into
  `astro.config.mjs` at the `// <<SIDEBAR>>` sentinel — the agent replaces the
  `sidebar: []` line's `[]` with the computed array (pretty-printed, 2-space
  indent, matching surrounding style).

The template ships this anchor:

```js
// <<SIDEBAR>> — replaced by the array generated from docs.manifest.json.
sidebar: [],
```

Each leaf entry has the shape `{ label, slug }`; each group has the shape
`{ label, items: [...] }` (optionally `collapsed`).

### 2.2 The algorithm

Iterate `pages` in manifest order:

1. **Skip** any page with `unmanaged: true` (the generator owns no sidebar entry
   for it).
2. Split the `slug` by the POSIX separator `/`.
3. A **single-segment** slug becomes a top-level leaf: `{ label, slug }`, where
   `label` is the titleized last segment.
4. A **multi-segment** slug is **grouped** by the titleized **first** path
   segment into a `{ label, items: [...] }` group. The **first occurrence** of a
   group label fixes that group's order in the array; later pages with the same
   first segment append to the existing group's `items`.

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

### 2.3 Reference TypeScript

The agent computes the array deterministically (a pure function of `pages`, so
byte-identical across agents):

```ts
interface PageEntry {
  slug: string; // POSIX, e.g. "guides/setup"
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
  const groupIndex = new Map<string, SidebarGroup>(); // group label → group node

  for (const page of pages) {
    // source (symlink vs native) does NOT affect the sidebar — both render
    // identically. Only `unmanaged` excludes a page.
    if (page.unmanaged) continue;

    const segments = page.slug.split("/");
    const leaf: SidebarLeaf = { label: titleize(last(segments)), slug: page.slug };

    if (segments.length === 1) {
      result.push(leaf); // top-level page
      continue;
    }
    const groupLabel = titleize(segments[0]);
    let group = groupIndex.get(groupLabel);
    if (!group) {
      group = { label: groupLabel, items: [] };
      groupIndex.set(groupLabel, group);
      result.push(group); // first occurrence fixes order
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

produces the substituted `sidebar` array:

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

On re-run, recompute `buildSidebar(pages)` from the (possibly updated) manifest
and re-substitute the `astro.config.mjs` sidebar **in place**. Because the
algorithm is a pure function of `pages`:

- An **identical manifest** yields a **no-op diff**.
- If the user hand-edited `astro.config.mjs` (its on-disk hash no longer matches
  the recorded provenance hash), the file is `RERUN_SKIP`ped and the divergence
  flagged — never clobbered.
