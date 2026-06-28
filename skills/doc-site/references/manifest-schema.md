# `docs.manifest.json` — the manifest contract (agent reference)

`docs.manifest.json` is the **single source of truth** in the target repo. One
file feeds three consumers — sidebar generation, the symlinker, and the drift
guard — so they cannot drift apart.

This document is the agent-facing reference for the manifest's shape, its field
contract, its validation rules, and the `unmanaged` escape hatch.

---

## 1. Shape

```jsonc
{
  "site": {
    "title": "My Project Docs",
    "description": "Documentation for My Project",
    "social": { "github": "https://github.com/acme/myproject" },
  },
  "pages": [
    { "slug": "intro", "source": "symlink", "from": "docs/intro.md" },
    { "slug": "guides/setup", "source": "native" },
    { "slug": "legacy", "unmanaged": true },
  ],
}
```

- `site.title` — Starlight site title (required, non-empty string).
- `site.description` — site description / meta (required string).
- `site.social` — optional `object<string, string-uri>`. Keys are Starlight
  social-icon names (e.g. `github`); values are URLs.
- `pages` — required ordered array of page entries. May be empty. **Array order
  is sidebar order.**

---

## 2. PageEntry field contract

| Field       | Type                        | Required                                                      | Meaning                                                                                                                                                                                                                        |
| ----------- | --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `slug`      | string                      | yes                                                           | Route slug, POSIX-style (`guides/setup`); **unique** across `pages`.                                                                                                                                                           |
| `label`     | string                      | no                                                            | Sidebar leaf-label override. Defaults to the titleized last slug segment (`guides/setup` → `Setup`). Only affects displayed text (core.md §2).                                                                                 |
| `group`     | string                      | no                                                            | Sidebar group-label override (multi-segment slugs only). Defaults to the titleized first slug segment; the first page in a group that sets it wins. Only affects displayed text (core.md §2).                                  |
| `source`    | `"symlink"` \| `"native"`   | required **unless** `unmanaged`                               | Where the page body comes from.                                                                                                                                                                                                |
| `from`      | string (repo-relative path) | required **iff** `source: "symlink"`; **forbidden** otherwise | Repo-root markdown file to symlink in. **Repo-relative from the repo root, NO leading `../`** (e.g. `docs/intro.md`). `setup-docs.sh` prepends `$REPO_ROOT/$1` and rejects any target that escapes the root (`symlink.md §2`). |
| `unmanaged` | boolean (default `false`)   | no                                                            | Escape hatch (see below). When `true`, `source`/`from` are not required and the generator does not wire the page.                                                                                                              |

---

## 3. Validation rules

Enforced by `docs.manifest.schema.json`:

1. `source: "symlink"` ⇒ `from` present and non-empty.
2. `source: "native"` ⇒ `from` absent.
3. `unmanaged: true` ⇒ `source`/`from` are optional; the page gets no sidebar entry
   (`buildSidebar` skips it at build time) and no symlink (see below).
4. `unmanaged` absent or `false` ⇒ `source` is required.
5. `slug` values are unique across `pages`. **Not expressible in JSON Schema**
   (`uniqueItems` compares whole items, not one property), so this rule is **not**
   in `docs.manifest.schema.json` — it is enforced by the drift guard's
   `duplicate-slug` rule (`check-docs.mjs`, **exit 2**; `drift-guard.md §2`). The
   agent also pre-checks slug-uniqueness during emit ("validate before wiring",
   `core.md §1`): a duplicate slug is rejected before any sidebar/symlink wiring.
6. Strict: `additionalProperties: false` at **every** level — no unknown keys
   anywhere.

A manifest that breaks rule 1, 2, 3, 4, or 6 is a `SCHEMA_VIOLATION`: reject with
the schema error before writing anything further. A duplicate slug (rule 5) is
caught by the agent's emit-time pre-check and by the drift guard at check time.

---

## 4. The `unmanaged: true` escape hatch

A page with `"unmanaged": true` is owned by the **user**, not the generator:

- The generator creates **no sidebar entry and no symlink** for it
  (`buildSidebar` skips `unmanaged` pages at build time).
- The drift guard **still applies** broken-internal-link and required-frontmatter
  checks to it.

This lets the user hand-manage edge cases — for example, a page reachable only by
a direct link, or a sidebar entry they add themselves — without the generator
fighting them. Because the escape hatch is scoped per-page, the single-source
guarantee still holds for every managed page: everything the generator owns stays
fully generated and cannot drift.

---

## 5. The schema is a hand-authored static asset

`docs.manifest.schema.json` is a **hand-authored** JSON Schema (Draft 2020-12),
shipped at the skill asset path `references/docs.manifest.schema.json`. It encodes
every rule in section 3.

It is **copied verbatim** into the docs package directory
(`{{DOCS_PKG_DIR}}/docs.manifest.schema.json`), beside `docs.manifest.json` — it
is **not** generated by any schema-generation step. Keeping it a static asset preserves the "no source
emitter changes" property of the skill.

In the target repo, the schema is **managed plumbing** (hash-tracked for
never-clobber), while `docs.manifest.json` itself is managed-but-merged on re-run.
