# Content-Sourcing / Symlink Layer (agent reference)

This reference covers the **symlink** template group — emitted only when the
component-selection record's `contentMode` is `symlink` or `mixed`. It documents
how the agent fills the generated tokens in
`references/templates/symlink/setup-docs.sh.tmpl` and how the script is wired into
the core `package.json`.

The script is idempotent (`ln -sfn`, no-dereference) and repo-confined. The
authoritative re-run / safety policy is covered in `rerun.md`; this file is the
emit-time procedure.

---

## 1. Gating: native vs symlink vs mixed

The `symlink/` group is emitted **only** when `contentMode ∈ {symlink, mixed}`:

| `contentMode` | Emit `setup-docs.sh`? | `predev`/`prebuild` wiring? | Pages symlinked                                      |
| ------------- | --------------------- | --------------------------- | ---------------------------------------------------- |
| `native`      | **No**                | **No**                      | None (pages live in the site).                       |
| `symlink`     | Yes                   | Yes                         | Every `source: "symlink"` page.                      |
| `mixed`       | Yes                   | Yes                         | Only `source: "symlink"` pages; `native` left alone. |

In **native** mode the content layer contributes **zero files** — no
`setup-docs.sh`, no `predev`/`prebuild` entries. This is part of the decline-all
invariant (`00 §5`).

`symlink` and `mixed` use the **identical** template. The only difference is which
manifest pages produce `link_file` lines — that is data, not template logic.

---

## 2. Generating `{{SYMLINK_PAGE_LINES}}` from the manifest

The agent reads `docs.manifest.json` (`00 §2`) and emits one
line **per page where `source == "symlink"` AND `unmanaged != true`**:

```sh
link_file "<from>" "<slug>"
```

where `<from>` is the page's repo-relative `from` value and `<slug>` is its `slug`.

Rules:

- `source: "native"` pages → **no line** (the page is authored in the site).
- `unmanaged: true` pages → **no line** (escape hatch, `00 §2.3`; the user manages
  the file directly).
- Pages are emitted in **manifest order**.

> **`from` is repo-relative from the repo root, with NO leading `../`.** At runtime
> `setup-docs.sh`'s `assert_inside_repo` prepends `$REPO_ROOT/$1` and canonicalizes
> the result, then **refuses** any target that escapes the repo root. A `from` like
> `../docs/intro.md` resolves to `$REPO_ROOT/../docs/intro.md` — **outside** the
> repo — and is rejected (exit 1). Write `docs/intro.md`, not `../docs/intro.md`.
> The same rule applies to `{{IMAGES_SRC_DIR}}` (e.g. `docs/images`, never
> `../docs/images`). The relative symlink the script writes is computed by
> `rel_path` from the content dir — you do **not** hand-author the `../` chain.

The generated lines replace the `{{SYMLINK_PAGE_LINES}}` placeholder, which sits
inside the `# >>> manifest-managed symlinks` … `# <<<` marker block. The
`link_dir "{{IMAGES_SRC_DIR}}" "images"` line that follows it is part of the
template (not generated) and is always present.

### Example

For a manifest with pages `intro` (symlink, `from: docs/intro.md`),
`guides/setup` (native), and `legacy` (unmanaged), the resolved block is:

```sh
# >>> manifest-managed symlinks (generated from docs.manifest.json at emit time)
# One link_file call per `source: "symlink"` page; native/unmanaged pages omitted.
link_file "docs/intro.md" "intro"
# Directory symlink for images so `images/<x>.svg` resolves on GitHub and Starlight:
link_dir "docs/images" "images"
# <<< manifest-managed symlinks
```

The `guides/setup` (native) and `legacy` (unmanaged) pages contribute no line.

---

## 2.1 Choosing slugs (read before mapping docs)

A page's `slug` simultaneously decides **three** coupled things, so pick it
deliberately:

1. **The route / URL** the page is served at.
2. **The on-disk content filename** — `setup-docs.sh` writes the symlink at
   `$CONTENT_DIR/<slug>.md`, so a slug `guides/usage` materializes
   `src/content/docs/guides/usage.md`.
3. **Whether the source doc's own relative links resolve** — the `broken-link`
   drift rule is a strict on-disk check from the symlinked file's location.

Guidance, learned from real runs:

- **Preserve the source directory structure in slugs.** Flattening
  `architecture/forge-bootstrap/guides/integration.md` to slug
  `forge-bootstrap/integration` breaks that doc's own `./guides/integration.md` /
  `../cli-reference.md` links (the guard flags them). Keeping the nested slug
  `forge-bootstrap/guides/integration` keeps the intra-doc relative links valid.
- **The sidebar groups by the FIRST path segment only** (`§2.2`, single level).
  `forge-bootstrap/guides/integration` lands in the **Forge Bootstrap** group with a
  leaf labeled from the **last** segment ("Integration"). You cannot get
  `Architecture > Forge Bootstrap > Integration` nesting from slugs — choose the
  first segment to be the group you want.
- **Use lowercase, hyphenated slugs; never a capital-letter slug in the sidebar.**
  Astro **lowercases** content slugs (`README.md` → route `readme`), so a sidebar
  entry `slug: "forge-bootstrap/README"` throws _"reference a valid entry slug."_ But
  the on-disk file **casing matters** for the `broken-link` disk check on
  case-sensitive Linux. Cleanest fix for a `README` page: rename its slug to
  `overview` and convert the now-unmatchable `./README.md` link to an absolute URL
  (below).
- **Out-of-site references must become absolute URLs.** Source docs that link
  **outside** the docs site (the repo-root `README.md`, sibling `references/…`) can't
  resolve inside `src/content/docs/`, so `broken-link` flags them. The guard
  intentionally **skips** `https?:` / `mailto:` / anchor links, so the sanctioned fix
  is to rewrite genuinely-external references to **absolute GitHub URLs** (which work
  on the site **and** on GitHub). **Ask before editing committed source docs.**
- The `broken-link` rule is **stricter than Starlight's runtime** (a static disk
  check vs. Starlight's relative-`.md` rewriting): a page can build fine yet still be
  flagged. Don't chase phantom build failures — reconcile the link or the slug.

---

## 3. Deriving `{{DOCS_PKG_DIR_TO_ROOT}}`

`{{DOCS_PKG_DIR_TO_ROOT}}` is the `../` chain from `{{DOCS_PKG_DIR}}` back up to the
repo root. It is a **pure function of `{{DOCS_PKG_DIR}}`** — one `..` per path
segment, joined with `/`:

| `{{DOCS_PKG_DIR}}` | path segments | `{{DOCS_PKG_DIR_TO_ROOT}}` |
| ------------------ | ------------- | -------------------------- |
| `docs`             | 1             | `..`                       |
| `packages/docs`    | 2             | `../..`                    |
| `apps/web/docs`    | 3             | `../../..`                 |

It adds no interview question (derived deterministically) and keeps output
byte-identical across targets (REQ-PORT-02). At runtime the script does
`cd "$SCRIPT_DIR/{{DOCS_PKG_DIR_TO_ROOT}}"` to resolve `REPO_ROOT` regardless of the
caller's working directory.

---

## 4. `predev` / `prebuild` wiring in the core `package.json`

When `contentMode ∈ {symlink, mixed}`, the agent adds **two** script entries to the
core `package.json` template's `scripts` block (`core.md` owns the template; this
layer contributes the lines):

```jsonc
{
  "scripts": {
    "predev": "sh ./setup-docs.sh",
    "prebuild": "sh ./setup-docs.sh",
  },
}
```

`predev`/`prebuild` are npm/pnpm/bun lifecycle pre-hooks: they run before `dev` and
`build`, so the symlinks are always fresh before Astro reads the content collection.

The script is invoked as `sh ./setup-docs.sh` (not `./setup-docs.sh`) so it does not
depend on the executable bit surviving checkout on every platform, and to pin the
POSIX-`sh` interpreter regardless of the file's shebang.

### Composition with diagrams

If the **diagrams** component is also selected, its prebuild snippet and this
symlink prebuild are composed into a single `prebuild` by the agent —
**symlink setup first, then diagram generation**
(`sh ./setup-docs.sh && npm run diagrams`). The order is safe because the shipped
diagram snippet renders to **`public/diagrams/`** (served directly by Astro as a
static asset), **not** into `{{IMAGES_SRC_DIR}}` — so there is no "SVGs must exist
before `link_dir`" dependency. The composition rule is owned by `diagrams.md`
(item 006); this layer just contributes the `setup-docs.sh` step.

---

## 5. Where the script is written

The resolved script is written to the target repo at `{{DOCS_PKG_DIR}}/setup-docs.sh`
with mode `0755`. It is a **managed plumbing file**: its sha256 is recorded in
`.doc-site-scaffold.json` so re-run can detect a user edit and skip overwriting it
(see `rerun.md`).
