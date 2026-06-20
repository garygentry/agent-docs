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
