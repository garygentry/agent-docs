# 03 — Core Site Scaffold & Manifest-Driven Sidebar

The **core site scaffold** is the always-emitted template group (`core/`,
`01-architecture-layout.md §2.2`): the minimum buildable Astro 5 + Starlight docs
package. This document specifies every template asset under
`references/templates/core/` — what each emits, the `{{TOKEN}}`s it carries (cited
from `00-core-definitions.md §4.1`), and the target-repo path it lands at — plus
the **single most important mechanic** of the whole feature: the Starlight
sidebar is **generated from `docs.manifest.json`** (the manifest schema is owned by
`00-core-definitions.md §2`), never hand-kept in parallel (REQ-CONTENT-03).

It also specifies where the generator writes the manifest itself
(`docs.manifest.json`) and its shipped schema (`docs.manifest.schema.json`) into
the target repo. This is the only document in the suite that **writes** the
manifest; the symlinker (`04-content-symlink-layer.md`) and drift guard
(`07-drift-guard.md`) only **read** it.

Everything here reproduces the canon gold master (`.reference/canon.md`,
"Reference Implementation" table and "five reusable mechanics", CON-04). Where
canon shows a literal value, this doc shows the same shape with a `{{TOKEN}}`
substituted.

## Requirement Coverage

| REQ / decision ID | Requirement | Section |
| ----------------- | ----------- | ------- |
| REQ-CORE-01 | Complete buildable Astro Starlight package (config, package manifest, tsconfig, content config, css, favicon, splash, ≥1 starter page) | 2, 3.1–3.8 |
| REQ-CORE-02 | `site`/`base` derived from env (`SITE`/`BASE_PATH`) — same build on subpath & root | 3.1, 4 |
| REQ-CORE-03 | `passthroughImageService()` — no heavyweight Sharp dependency for SVG diagrams | 3.1, 5 |
| REQ-CONTENT-01 | Manifest expresses symlink / native / mixed modes; sidebar renders all | 6, 7 |
| REQ-CONTENT-03 | Single canonical manifest drives the sidebar (one source, cannot drift) | 6, 7 |
| REQ-CONTENT-04 | Sidebar generation honors each page's `source` (symlink vs native) uniformly | 7.3 |
| (tech §3.3) | Core scaffold = canon's gold-master file set, parameterized | 3 |
| (tech §3.4) | `content.config.ts` = `docsLoader()` + `docsSchema()` | 3.4 |
| (00 §2.3 / OQ-2) | `unmanaged: true` pages excluded from generated sidebar | 7.4 |

## 2. Purpose & scope

**In scope (this document):**
- Each `references/templates/core/` asset: emitted body with `{{TOKEN}}`s, target
  path, whether it is a managed plumbing file (tracked in `.doc-site-scaffold.json`,
  `00 §3`) or authored content (never tracked).
- Env-driven `site`/`base` (REQ-CORE-02), passthrough image service
  (REQ-CORE-03), the Starlight content collection (tech §3.4), accent-only CSS.
- Writing `docs.manifest.json` + `docs.manifest.schema.json` into the target.
- The **sidebar-from-manifest algorithm** the agent runs to fill the
  `astro.config.mjs` `sidebar` array (REQ-CONTENT-03/04).

**Out of scope (other documents):**
- The manifest field contract & schema rules — owned by `00 §2` (referenced, not
  redefined here).
- The symlinker that materializes `source: symlink` page bodies —
  `04-content-symlink-layer.md`.
- Diagram prebuild wiring, deploy wiring, drift guard, monorepo registration,
  re-run/provenance — `05`–`08`.

**Target-repo docs package directory** is `{{DOCS_PKG_DIR}}` (`00 §4.1`; default
`docs/` single-package, `packages/docs/` monorepo). All target paths below are
written relative to it unless they start with the repo root (e.g.
`docs.manifest.json` and `public/`-rooted assets follow the canon layout).

## 3. Core template assets (`references/templates/core/`)

Each asset rides verbatim into every agent bundle (`01 §2.1`); the agent performs
**plain string `{{TOKEN}}` replacement** (`00 §4`) then writes to the target path.
All eight core assets are **managed plumbing** (hash-tracked for never-clobber,
`00 §3`) **except** `index.mdx` and `starter-page.mdx`, which are **authored
content** the agent emits once and never overwrites on re-run (REQ-RERUN-02; these
are the `source: native` seed pages).

| Asset (`core/…`) | Target path (under `{{DOCS_PKG_DIR}}`) | Managed? | Tokens |
| --- | --- | --- | --- |
| `astro.config.mjs.tmpl` | `astro.config.mjs` | yes | `{{SITE_TITLE}}` `{{SITE_DESC}}` `{{GITHUB_URL}}` + generated sidebar (§7) |
| `package.json.tmpl` | `package.json` | yes | `{{SITE_TITLE}}` `{{ASTRO_VERSION}}` `{{STARLIGHT_VERSION}}` |
| `tsconfig.json.tmpl` | `tsconfig.json` | yes | (none) |
| `content.config.ts.tmpl` | `src/content.config.ts` | yes | (none) |
| `custom.css.tmpl` | `src/styles/custom.css` | yes | `{{ACCENT_LIGHT}}` `{{ACCENT_DARK}}` |
| `favicon.svg` | `public/favicon.svg` | yes | (none — verbatim asset) |
| `index.mdx.tmpl` | `src/content/docs/index.mdx` | no (authored) | `{{SITE_TITLE}}` `{{SITE_DESC}}` |
| `starter-page.mdx.tmpl` | `src/content/docs/guides/setup.mdx` | no (authored) | `{{SITE_TITLE}}` |

> All tokens above are defined in `00 §4.1`. This document introduces **no new
> tokens**; per `00 §4` any new token would require a row there and in SKILL.md.

### 3.1 `astro.config.mjs.tmpl` → `astro.config.mjs` (REQ-CORE-01/02/03)

The keystone config. Faithful to canon (`astro.config.mjs` row: title/description,
social, sidebar tree, `customCss`, env `site`/`base`, `passthroughImageService()`).
The `sidebar: [ … ]` body is **not** a static token — it is replaced wholesale by
the array the agent computes in §7. Everything else is plain substitution.

```js
// astro.config.mjs — emitted into {{DOCS_PKG_DIR}}/
// MANAGED by doc-site-plugin (tracked in .doc-site-scaffold.json). The `sidebar`
// array is generated from docs.manifest.json — edit the manifest, not this file.
import { defineConfig, passthroughImageService } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  // REQ-CORE-02: derive site/base from env so the SAME build works on a hosted
  // subpath (GitHub Pages, BASE_PATH="/repo/") and at root (Vercel/static,
  // BASE_PATH unset) with no code changes. Both are undefined-safe: Astro treats
  // an undefined `base` as "/" and an undefined `site` as a relative build.
  site: process.env.SITE,
  base: process.env.BASE_PATH,
  // REQ-CORE-03: SVG diagrams need no rasterization; the passthrough image
  // service serves them as-is and keeps the install free of the Sharp dependency.
  image: { service: passthroughImageService() },
  integrations: [
    starlight({
      title: "{{SITE_TITLE}}",
      description: "{{SITE_DESC}}",
      social: [
        { icon: "github", label: "GitHub", href: "{{GITHUB_URL}}" },
      ],
      // <<SIDEBAR>> — replaced by the array generated in §7 from docs.manifest.json.
      // REQ-CONTENT-03: single source of truth; never hand-kept in parallel.
      sidebar: [],
      customCss: ["./src/styles/custom.css"],
    }),
  ],
});
```

**Sidebar substitution.** The literal `sidebar: []` line carries the sentinel
comment `// <<SIDEBAR>>`. The agent replaces `[]` with the JSON-array literal
produced by §7 (pretty-printed, 2-space indent, matching surrounding style). This
is mechanical text replacement — the array content is a pure function of the
manifest (REQ-PORT-02).

**Social links.** `{{GITHUB_URL}}` is derived from `{{REPO_SLUG}}` (`00 §4.1`,
default `""`). If the manifest `site.social` (`00 §2.2`) carries keys beyond
`github`, the agent appends one `{ icon, label, href }` object per key (icon =
the Starlight social-icon name = the key; href = the value). If `site.social` is
absent and `{{GITHUB_URL}}` is `""`, the `social` array is emitted empty (`social: []`).

> **Starlight `social` shape (verified).** Current `@astrojs/starlight` expects
> `social` as an **array** of `{ icon, label, href }` objects (confirmed against
> the canon gold master `packages/docs/astro.config.mjs:16`). The older
> object-map form (`social: { github: "…" }`) is **not** emitted.

**Error handling.**
- If the manifest is missing or fails schema validation, the agent does **not**
  write this file — it reports `SCHEMA_VIOLATION` (`00 §7`) first (the sidebar
  cannot be generated without a valid manifest).
- On re-run, if the on-disk hash ≠ provenance record, the agent emits
  `RERUN_SKIP` for this file (`00 §3.3`) — never clobbering a user-edited config.

### 3.2 `package.json.tmpl` → `package.json` (REQ-CORE-01)

The docs-package manifest. Canon (`package.json` row): `dev`/`build`/`preview`
scripts and pinned `astro`/`@astrojs/starlight`. The `predev`/`prebuild` hooks
from canon belong to optional components (symlink `04`, diagrams `05`) and are
**not** in the core template — they are added only when those components are
selected (REQ-USE-01). The core file ships the minimal script set.

```jsonc
{
  "name": "{{SITE_TITLE}}-docs",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview"
  },
  "dependencies": {
    "astro": "{{ASTRO_VERSION}}",
    "@astrojs/starlight": "{{STARLIGHT_VERSION}}"
  }
}
```

- `name` is slugified from `{{SITE_TITLE}}` (lowercased, non-alphanumerics → `-`)
  with a `-docs` suffix; for a monorepo the workspace-scoped name and the
  `predev`/`prebuild` additions are layered by the `monorepo/` group
  (`06-deploy-and-monorepo.md`) and the symlink/diagram groups, not here.
- `{{ASTRO_VERSION}}` / `{{STARLIGHT_VERSION}}` (`00 §4.1`): resolved to **latest**
  at first scaffold (REQ-REL-02) and recorded as `astroPin` / `starlightPin` in
  `.doc-site-scaffold.json` (`00 §3.2`); on re-run the recorded pins are reused
  (REQ-RERUN-01), so a second run is a no-op diff (REQ-REL-01).

**Error handling.** If version resolution fails (e.g. no network at first
scaffold), the agent falls back to the documented known-good set
(`08-rerun-and-verification.md §version-pin`) and flags the assumption
(REQ-USE-02); it does not hard-fail.

### 3.3 `tsconfig.json.tmpl` → `tsconfig.json` (REQ-CORE-01)

Faithful to canon (`tsconfig.json` extends Astro's strict base). No tokens.

```jsonc
{
  "extends": "astro/tsconfigs/strict"
}
```

**Verification.** `astro check` / `tsc --noEmit` in the target resolves this
extends path once `astro` is installed (the dependency from §3.2).

### 3.4 `content.config.ts.tmpl` → `src/content.config.ts` (REQ-CORE-01, tech §3.4)

The Starlight content collection — verbatim canon. No tokens. This is the binding
that makes both symlinked and native pages under `src/content/docs/**` resolve as
the `docs` collection.

```ts
import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
};
```

> **Verified** against the canon gold master `packages/docs/src/content.config.ts`
> — `docsLoader()` from `@astrojs/starlight/loaders`, `docsSchema()` from
> `@astrojs/starlight/schema`. These are the current Astro 5 / Starlight content
> APIs (the `src/content.config.ts` location replaced the legacy
> `src/content/config.ts` in Astro 5).

### 3.5 `custom.css.tmpl` → `src/styles/custom.css` (REQ-CORE-01)

**Accent-only theming** (canon `custom.css` row: light + dark `--sl-color-accent*`,
no component overrides). Carries `{{ACCENT_LIGHT}}` / `{{ACCENT_DARK}}` (`00 §4.1`,
default = canon accents). Each token is the accent's mid color; the low/high
shades are derived by the template's fixed structure (the agent substitutes the
two mid values; the surrounding shade scaffold is canon-fixed).

```css
/* Accent-color theming only (matches canon custom.css). No component overrides.
   {{ACCENT_LIGHT}} / {{ACCENT_DARK}} are the only tokens — see 00 §4.1. */
:root {
  /* dark theme (Starlight default) */
  --sl-color-accent-low: color-mix(in srgb, {{ACCENT_DARK}} 30%, black);
  --sl-color-accent: {{ACCENT_DARK}};
  --sl-color-accent-high: color-mix(in srgb, {{ACCENT_DARK}} 40%, white);
}

:root[data-theme="light"] {
  --sl-color-accent-low: color-mix(in srgb, {{ACCENT_LIGHT}} 40%, white);
  --sl-color-accent: {{ACCENT_LIGHT}};
  --sl-color-accent-high: color-mix(in srgb, {{ACCENT_LIGHT}} 30%, black);
}
```

> Canon uses three hand-picked hex values per theme; the template reduces the
> interview surface to a single accent per theme (`{{ACCENT_LIGHT}}`,
> `{{ACCENT_DARK}}`) and derives the low/high shades via `color-mix()` (CSS
> Color 5, supported by every browser Starlight targets), staying faithful to the
> "accent-only, two-theme" canon mechanic. Defaults reproduce the canon blues.

### 3.6 `favicon.svg` → `public/favicon.svg` (REQ-CORE-01)

A static SVG asset, **no tokens**, emitted verbatim (canon `public/favicon.svg`
row). Shipped as a real `.svg` (not `.tmpl`) so it rides byte-for-byte. The
default is a neutral document glyph (canon uses a project-specific emoji glyph; a
generic generator ships a neutral mark the user can replace):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">
  <text x="2" y="30" font-size="32">📄</text>
</svg>
```

### 3.7 `index.mdx.tmpl` → `src/content/docs/index.mdx` (REQ-CORE-01)

The **splash landing page** (`template: splash`, canon `index.mdx`). This is
**authored content** (`source: native`, never tracked for overwrite — `00 §3`,
REQ-RERUN-02). Carries `{{SITE_TITLE}}` / `{{SITE_DESC}}`.

```mdx
---
title: {{SITE_TITLE}}
description: {{SITE_DESC}}
template: splash
hero:
  tagline: {{SITE_DESC}}
  actions:
    - text: Get Started
      link: guides/setup/
      icon: right-arrow
---

import { Card, CardGrid } from "@astrojs/starlight/components";

Welcome to the **{{SITE_TITLE}}** documentation.

<CardGrid>
  <Card title="Get started" icon="rocket">
    Head to the [setup guide](guides/setup/) to begin.
  </Card>
  <Card title="Single source of truth" icon="document">
    Pages are driven by `docs.manifest.json`; edit the manifest to change the
    sidebar.
  </Card>
</CardGrid>
```

> The `index.mdx` slug is **not** listed in `docs.manifest.json` `pages` (the
> splash is the route root `/`, not a sidebar entry); it is the implicit home and
> is excluded from sidebar generation (§7).

### 3.8 `starter-page.mdx.tmpl` → `src/content/docs/guides/setup.mdx` (REQ-CORE-01)

The **≥1 authored starter page** (REQ-CORE-01). Authored content, never tracked
for overwrite. Its slug — `guides/setup` — is the seed `source: native` page in
the default manifest (§6.2), so the scaffold builds green with a populated sidebar
even when no repo docs exist (the `ASSUME-NO-DOCS` → native-mode default, `00 §6.1`).

```mdx
---
title: Setup
description: Getting started with {{SITE_TITLE}}.
---

This is a starter page authored directly in the site (`source: "native"`).

Add more pages by editing `docs.manifest.json` at the repo root, then re-running
the generator (or `setup-docs.sh` in symlink mode).
```

## 4. Env-driven `site` / `base` (REQ-CORE-02)

The single deploy-portability mechanism shared by every deploy target
(`06-deploy-and-monorepo.md` consumes it; this doc owns its definition in
`astro.config.mjs`). Restated from §3.1:

```js
site: process.env.SITE,
base: process.env.BASE_PATH,
```

| Host | `SITE` | `BASE_PATH` | Result |
| --- | --- | --- | --- |
| GitHub Pages (project site) | `https://<user>.github.io` | `/<repo>/` | assets resolve under the subpath |
| Vercel / generic static (root) | `https://<prod-url>` (or unset) | unset (→ `/`) | assets resolve at root |
| Local `astro dev` | unset | unset | served at `http://localhost:4321/` |

No code edit is needed to switch hosts (REQ-DEPLOY-02) — only the environment
differs. The deploy templates (`06`) supply these env vars per host; they never
re-edit `astro.config.mjs`.

## 5. Image service (REQ-CORE-03)

`image: { service: passthroughImageService() }` (§3.1). Diagrams emitted by the
optional diagram component (`05-diagrams-component.md`) are theme-aware SVGs that
need no rasterization, so the passthrough service serves them as-is and the build
avoids the heavyweight Sharp native dependency — keeping installs lightweight
regardless of whether the diagram component is selected (the passthrough service
is core and always present, faithful to canon mechanic #2).

## 6. Writing the manifest into the target repo

This phase (`SKILL.md` Phase 4, `01 §4`) writes two files. **The field contract,
validation rules, and escape hatch are owned by `00 §2` — not redefined here.**

### 6.1 Files & locations

| File | Target path | Source | Role |
| --- | --- | --- | --- |
| `docs.manifest.json` | **repo root** (`./docs.manifest.json`) | authored by the agent from interview answers (`02-detection-and-interview.md`) | the single source of truth (`00 §2`) |
| `docs.manifest.schema.json` | **repo root** (`./docs.manifest.schema.json`) | copied verbatim from the skill asset `references/docs.manifest.schema.json` (`00 §2.4`) | validates the manifest in the target |

Both land at the **repo root** (alongside, not inside, `{{DOCS_PKG_DIR}}`) because
all three consumers — sidebar (this doc), symlinker (`04`), drift guard (`07`) —
and the repo's CI read them from one well-known root location, matching the canon
"single manifest is the canonical input" mechanic.

The manifest carries a `$schema` reference so editors validate it:

```jsonc
{
  "$schema": "./docs.manifest.schema.json",
  "site": { "title": "{{SITE_TITLE}}", "description": "{{SITE_DESC}}",
            "social": { "github": "{{GITHUB_URL}}" } },
  "pages": [ /* §6.2 */ ]
}
```

`docs.manifest.schema.json` is **hand-authored, static** (NOT schema-gen output —
`00 §2.4`, tech §3.4) and is itself **managed plumbing** (hash-tracked, `00 §3`);
`docs.manifest.json` is managed-but-merged on re-run (`08`): the generator updates
generated structure in place without clobbering user-added page entries.

### 6.2 Default `pages` (native-mode seed)

When detection finds no repo docs (`ASSUME-NO-DOCS`, `00 §6.1`) and the user picks
native mode, the manifest seeds exactly the authored starter page (§3.8):

```jsonc
"pages": [
  { "slug": "guides/setup", "source": "native" }
]
```

In symlink/mixed mode the interview maps each repo markdown file to a slug
(`02-detection-and-interview.md`), producing `{ "slug": "...", "source":
"symlink", "from": "docs/..." }` entries per `00 §2.2`. Page **order in the array
is sidebar order** (`00 §2.2`, `pages` row) — §7 relies on this.

### 6.3 Error handling

- Before writing any sidebar or wiring, the agent validates the assembled manifest
  against `docs.manifest.schema.json`. A violation → `SCHEMA_VIOLATION` (`00 §7`):
  reject with the schema error, write nothing further.
- Duplicate `slug` values, a `from` on a `native` page, or a missing `from` on a
  `symlink` page are caught by the schema (`00 §2.2` rules 1–6) — surfaced as
  `SCHEMA_VIOLATION`, not silently fixed.

## 7. Sidebar-from-manifest algorithm (REQ-CONTENT-01/03/04)

The Starlight `sidebar` array in `astro.config.mjs` (§3.1) is **generated from
`docs.manifest.json` `pages`** — the parallel hand-kept sidebar/symlink/diagram
lists that canon maintained "by comment" are collapsed into one source
(REQ-CONTENT-03; canon "Scaffold §2" improvement: "emitted from one shared
manifest so they cannot drift").

### 7.1 Input → output

- **Input:** the ordered `pages` array (`00 §2.2`) from the manifest written in §6.
- **Output:** a Starlight `sidebar` array literal substituted into the
  `// <<SIDEBAR>>` sentinel in `astro.config.mjs` (§3.1).

Each Starlight leaf entry has the shape `{ label: string; slug: string }` and each
group `{ label: string; items: SidebarEntry[]; collapsed?: boolean }` (the canon
`sidebar` shapes, `packages/docs/astro.config.mjs:23-71`).

### 7.2 Algorithm

The agent computes the array deterministically (pure function of `pages`, so
byte-identical across agents — REQ-PORT-02):

```ts
// Reference algorithm (the agent performs this, then writes the literal result).
// Types mirror the Starlight sidebar shape and the manifest PageEntry (00 §2.2).
interface PageEntry {
  slug: string;                       // POSIX, e.g. "guides/setup" (00 §2.2)
  source?: "symlink" | "native";      // 00 §2.2 / REQ-CONTENT-04
  from?: string;                      // present iff source === "symlink"
  unmanaged?: boolean;                // 00 §2.3 escape hatch
}
type SidebarLeaf = { label: string; slug: string };
type SidebarGroup = { label: string; items: SidebarEntry[]; collapsed?: boolean };
type SidebarEntry = SidebarLeaf | SidebarGroup;

/**
 * Build the Starlight sidebar array from manifest pages, preserving manifest
 * order (= sidebar order, 00 §2.2). Pages are grouped by their slug's first
 * POSIX path segment; single-segment slugs become top-level leaves. The home
 * splash ("" / index) is never included.
 *
 * @param pages - manifest `pages`, in manifest (sidebar) order
 * @returns the sidebar array literal to substitute into astro.config.mjs (§3.1)
 */
function buildSidebar(pages: PageEntry[]): SidebarEntry[] {
  const result: SidebarEntry[] = [];
  const groupIndex = new Map<string, SidebarGroup>(); // group label → group node

  for (const page of pages) {
    // REQ-CONTENT-04 / 00 §2.3: source (symlink vs native) does NOT affect the
    // sidebar — both render identically. Only `unmanaged` excludes a page.
    if (page.unmanaged) continue;                      // §7.4

    const segments = page.slug.split("/");
    const leaf: SidebarLeaf = { label: titleize(last(segments)), slug: page.slug };

    if (segments.length === 1) {
      result.push(leaf);                               // top-level page
      continue;
    }
    const groupLabel = titleize(segments[0]);
    let group = groupIndex.get(groupLabel);
    if (!group) {
      group = { label: groupLabel, items: [] };
      groupIndex.set(groupLabel, group);
      result.push(group);                              // first occurrence fixes order
    }
    group.items.push(leaf);
  }
  return result;
}

/** "guides/setup" segment "getting-started" → "Getting Started". */
function titleize(segment: string): string {
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
const last = <T,>(a: T[]): T => a[a.length - 1];
```

**Worked example.** Manifest `pages` (in order):

```jsonc
[
  { "slug": "intro",                 "source": "symlink", "from": "docs/intro.md" },
  { "slug": "guides/setup",          "source": "native" },
  { "slug": "guides/recovery",       "source": "symlink", "from": "docs/recovery.md" },
  { "slug": "reference/cli",         "source": "native" },
  { "slug": "legacy",                "unmanaged": true }
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
  // `legacy` omitted — unmanaged (00 §2.3, §7.4)
],
```

### 7.3 Native vs symlink pages are identical in the sidebar (REQ-CONTENT-04)

A page's `source` distinguishes **how its body reaches `src/content/docs/`** (the
symlinker materializes `symlink` pages — `04`; native pages are authored files),
**not** how it appears in the sidebar. `buildSidebar` therefore ignores `source`
entirely: a `symlink` page and a `native` page with the same slug yield the same
`{ label, slug }` entry. This is what makes **mixed mode** fully expressible
through one manifest (REQ-CONTENT-01/04): the sidebar is uniform; only the content
bridge differs. The leaf `slug` is exactly the manifest `slug`; Starlight resolves
it against the `docs` collection (§3.4) regardless of whether the underlying file
is a symlink or a real file.

### 7.4 Unmanaged pages are excluded (00 §2.3, OQ-2)

A page with `"unmanaged": true` (`00 §2.3`) is **skipped** by `buildSidebar` — the
generator does not create its sidebar entry (the user manages it manually, e.g. an
extra `sidebar` entry they hand-add, or a page reachable only by direct link). The
drift guard correspondingly **exempts unmanaged pages from sidebar↔manifest
parity** (`07-drift-guard.md`, `00 §2.3`), so a hand-added sidebar entry for an
unmanaged page does not trip drift. Managed pages remain fully generated, so the
single-source guarantee holds for everything the generator owns.

### 7.5 Re-run behavior

On re-run the agent recomputes `buildSidebar(pages)` from the (possibly updated)
manifest and re-substitutes the `astro.config.mjs` sidebar **in place**
(REQ-RERUN-01). Because the algorithm is a pure function of `pages` and the config
is otherwise unchanged, an identical manifest yields a no-op diff (REQ-REL-01). If
the user hand-edited `astro.config.mjs` (hash ≠ provenance, `00 §3.3`), the file is
`RERUN_SKIP`ped and the divergence flagged rather than clobbered.

## Dependencies

- **`00-core-definitions.md`** — the manifest schema & field contract (§2), the
  `unmanaged` escape hatch (§2.3), the provenance manifest & re-run decision table
  (§3), the `{{TOKEN}}` vocabulary (§4.1), the error/outcome taxonomy (§7). This
  document **references** all of these and redefines none.
- **`01-architecture-layout.md`** — the `core/` template-asset paths (§2.2), the
  template-substitution model (§2.1), and the `{{DOCS_PKG_DIR}}` placement.

Consumed by (must be implemented after this writes the manifest):
`04-content-symlink-layer.md` (reads `pages` `from`), `07-drift-guard.md`
(sidebar↔manifest parity). Composed with by `06-deploy-and-monorepo.md`
(env `site`/`base`, monorepo `package.json` additions) and `05-diagrams-component.md`
(adds the `prebuild` hook to the §3.2 `package.json`).

## Verification

- [ ] All eight `core/` assets exist under `references/templates/core/` with the exact
      target paths in §3, and every `{{TOKEN}}` they contain is one of those listed
      (and thus present in `00 §4.1` + SKILL.md — token-coverage test, `10`).
- [ ] A scaffold-output golden fixture (`10-testing-strategy.md`) with a known
      interview-answer set resolves `astro.config.mjs` byte-for-byte, including the
      generated sidebar array (proves §7 is deterministic / agent-agnostic).
- [ ] `astro.config.mjs` `site`/`base` read from `process.env.SITE`/`BASE_PATH`
      (REQ-CORE-02); a build with `BASE_PATH="/x/"` emits subpath-prefixed asset
      URLs and a build with it unset emits root-relative URLs.
- [ ] `astro.config.mjs` sets `image.service = passthroughImageService()` and the
      target install pulls **no** `sharp` package (REQ-CORE-03).
- [ ] `content.config.ts` matches §3.4 byte-for-byte (canon fidelity, tech §3.4).
- [ ] `custom.css` defines only `--sl-color-accent*` (light + dark), no component
      overrides (canon fidelity); `{{ACCENT_LIGHT}}`/`{{ACCENT_DARK}}` substituted.
- [ ] `docs.manifest.json` and `docs.manifest.schema.json` land at the **repo
      root**; the manifest validates against the schema (`00 §2.4`).
- [ ] `buildSidebar` (§7.2) over the §7.2 worked-example manifest yields the
      shown array; the `unmanaged` page is absent (§7.4); native and symlink pages
      render identical leaves (§7.3, REQ-CONTENT-04).
- [ ] The decline-all minimal scaffold (`00 §5`: native mode, no diagrams/deploy/
      drift) emits **only** the core file set in §3 plus the two repo-root manifest
      files — and the emitted `astro build` goes green (REQ-VERIFY-01).
- [ ] Re-running with an unchanged manifest produces a no-op git diff for
      `astro.config.mjs` (REQ-REL-01); a user-edited config is `RERUN_SKIP`ped, not
      clobbered (REQ-RERUN-02, §7.5).
