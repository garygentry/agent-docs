# 04 — Content-Sourcing / Symlink Layer

How `doc-site-plugin` bridges repo-root markdown into the Starlight content
collection so that **the repo's markdown stays the single source of truth and the
site is a thin view over it** (PRD §1, canon §3). This document owns the runtime
behavior of the **symlink** and **mixed** content-sourcing modes: the emitted
`setup-docs.sh` POSIX script, its idempotency contract, the no-dereference handling
for the `images/` directory symlink, the build-cache clear, the component-gated
`predev`/`prebuild` wiring, and the repo-confinement safety check.

It does **not** define the manifest (that is `00-core-definitions.md §2` and
`03-core-site-and-manifest.md`), and it does not own the authoritative re-run /
safety policy — that lives in `08-rerun-and-verification.md`, cross-referenced
below. This document consumes the manifest `03` emits and the tokens `00 §4` defines.

## Requirement Coverage

| REQ / decision ID | Requirement / decision                                                            | Section        |
| ----------------- | --------------------------------------------------------------------------------- | -------------- |
| REQ-CONTENT-01    | Symlink + mixed runtime behavior of the three content-sourcing modes              | §1, §6         |
| REQ-CONTENT-02    | Idempotent symlinker (relative paths, `ln -sfn`, `.astro` cache clear)            | §2, §3, §4, §5 |
| REQ-CONTENT-04    | `setup-docs.sh` is driven by per-page `source` field (symlink pages only)         | §2.3, §6       |
| REQ-SEC-02        | Emitted symlinks confined to repo tree (`from` may not escape repo root)          | §7             |
| REQ-REL-01        | Re-run yields a no-op git diff modulo build cache (idempotency at symlink level)   | §5             |
| tech-spec §3.5    | POSIX `sh`; `-n`/`--no-dereference` for the `images/` directory symlink            | §2, §4         |
| REQ-USE-01        | Native mode emits no symlinker; wiring added only when symlink/mixed selected      | §6             |

## 1. Purpose & scope

The content-sourcing layer realizes one of the three selectable modes from the
component-selection record (`00-core-definitions.md §5`, field `contentMode`):

| `contentMode` | This layer's behavior                                                                                         |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| `native`      | **Nothing.** No `setup-docs.sh` is emitted; no `predev`/`prebuild` wiring is added. Pages live in the site. |
| `symlink`     | Emit `setup-docs.sh`; wire `predev`/`prebuild`; the script symlinks **every** `source: "symlink"` page.      |
| `mixed`       | Emit `setup-docs.sh`; wire `predev`/`prebuild`; the script symlinks **only** the `source: "symlink"` pages and leaves `source: "native"` pages alone. |

The `symlink/` template group (`01-architecture-layout.md §2.2`) is emitted when
`contentMode ∈ {symlink, mixed}` and contains exactly one asset:
`references/templates/symlink/setup-docs.sh.tmpl`. Both modes use the **same** template;
the difference is purely which manifest pages the script iterates over, which is data,
not template logic (tech-spec §3.2 — no in-template conditionals).

### 1.1 Where the script is written in the target repo

The agent substitutes the tokens in §2.2 and writes the result to the target repo at:

```
{{DOCS_PKG_DIR}}/setup-docs.sh        # e.g. docs/setup-docs.sh  or  packages/docs/setup-docs.sh
```

with mode `0755` (executable). It is a **managed plumbing file**: its sha256 is
recorded in `.doc-site-scaffold.json` (`00-core-definitions.md §3`) so re-run can
detect a user edit (`08-rerun-and-verification.md`).

### 1.2 What the script bridges

Given the content collection root `{{DOCS_PKG_DIR}}/src/content/docs/`, the script
creates, per manifest page with `source: "symlink"`:

```
{{DOCS_PKG_DIR}}/src/content/docs/<slug>.md  ->  (relative path to)  <from>
```

plus a single `images/` **directory** symlink so that `images/foo.svg` references in
the markdown resolve identically on GitHub and inside Starlight (canon §, mechanic 3).

## 2. `setup-docs.sh` — full emitted body (template with tokens)

The template below is the literal content of
`references/templates/symlink/setup-docs.sh.tmpl`. It is **POSIX `sh`** — not bash-only:
no `pipefail`, no arrays, no `[[ ]]`, no `local`. It is portable across `dash`,
`ash` (busybox), and `bash` invoked as `sh`. The reference implementation
(`rauf/scripts/setup-docs.sh`) is bash with `set -euo pipefail`; we deliberately
downgrade to POSIX `sh` per tech-spec §3 / §3.5 so the emitted script runs in any
target repo's CI runner regardless of shell.

`{{DOCS_PKG_DIR}}` is substituted at scaffold time (a token from
`00-core-definitions.md §4.1`). The per-page `ln` lines (the block marked
`# >>> manifest-managed symlinks` … `# <<<`) are **generated from the manifest by
the agent at emit time** — one `link_file` / `link_dir` call per relevant page —
not hand-written; see §2.3.

```sh
#!/bin/sh
# setup-docs.sh — idempotent content symlinker for the docs site.
# Generated by doc-site-plugin (contentMode: symlink|mixed). Do not edit by hand;
# re-running the generator regenerates this file (a hand edit is detected and the
# file is skipped — see .doc-site-scaffold.json provenance).
#
# Creates RELATIVE-path symlinks from the Starlight content collection to the
# repo-root markdown that is the single source of truth. Idempotent: re-running
# yields the same links (ln -sf / ln -sfn) and a no-op git diff modulo the
# regenerated .astro cache.
set -eu

# --- Resolve repo root and the docs content collection directory -------------
# The script lives at {{DOCS_PKG_DIR}}/setup-docs.sh, so repo root is computed
# relative to the script's own location (works regardless of caller CWD).
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/{{DOCS_PKG_DIR_TO_ROOT}}" && pwd)
DOCS_PKG_DIR="$REPO_ROOT/{{DOCS_PKG_DIR}}"
CONTENT_DIR="$DOCS_PKG_DIR/src/content/docs"

echo "Setting up documentation symlinks..."
echo "  Repo root:   $REPO_ROOT"
echo "  Content dir: $CONTENT_DIR"

mkdir -p "$CONTENT_DIR"

# --- Safety: refuse any source path that escapes the repo tree (REQ-SEC-02) --
# Canonicalize the resolved target and assert it is inside $REPO_ROOT before
# linking. See 08-rerun-and-verification.md for the authoritative policy.
assert_inside_repo() {
  # $1 = repo-relative source path (the manifest `from` value, or images dir)
  _src="$REPO_ROOT/$1"
  _dir=$(dirname "$_src")
  if [ ! -d "$_dir" ]; then
    echo "ERROR: source directory does not exist: $_dir" >&2
    exit 1
  fi
  # Canonicalize the directory (follows .. and symlinks) then re-append basename.
  _canon_dir=$(cd "$_dir" && pwd -P)
  _canon="$_canon_dir/$(basename "$_src")"
  _root_canon=$(cd "$REPO_ROOT" && pwd -P)
  case "$_canon" in
    "$_root_canon"/*) : ;;  # inside repo — ok
    *)
      echo "ERROR: refusing symlink target outside repo root: $1" >&2
      echo "       resolved to: $_canon (repo root: $_root_canon)" >&2
      exit 1
      ;;
  esac
}

# --- link_file: relative-path symlink for a single source=symlink page -------
# $1 = repo-relative source markdown (manifest `from`); $2 = slug (dest name)
link_file() {
  assert_inside_repo "$1"
  if [ ! -f "$REPO_ROOT/$1" ]; then
    echo "ERROR: symlink source file not found: $1" >&2
    echo "       (manifest page '$2' references a missing 'from' target)" >&2
    exit 1
  fi
  _dest="$CONTENT_DIR/$2.md"
  mkdir -p "$(dirname "$_dest")"
  # Relative path FROM the destination's directory TO the source file.
  _rel=$(rel_path "$(dirname "$_dest")" "$REPO_ROOT/$1")
  ln -sf "$_rel" "$_dest"
  echo "  linked $2.md -> $_rel"
}

# --- link_dir: --no-dereference dir symlink (images/) -------------------------
# $1 = repo-relative source dir; $2 = dest name under content dir.
# CRITICAL: use ln -sfn (-n = --no-dereference). Without -n, a second run sees an
# existing symlink that points at a directory, dereferences it, and creates the
# new link *inside* the target dir (e.g. images/images), corrupting the tree.
link_dir() {
  assert_inside_repo "$1"
  if [ ! -d "$REPO_ROOT/$1" ]; then
    echo "ERROR: symlink source directory not found: $1" >&2
    exit 1
  fi
  _dest="$CONTENT_DIR/$2"
  _rel=$(rel_path "$(dirname "$_dest")" "$REPO_ROOT/$1")
  ln -sfn "$_rel" "$_dest"
  echo "  linked $2/ -> $_rel (no-dereference)"
}

# --- rel_path: pure-POSIX relative path from $1 (dir) to $2 (file/dir) --------
# Both args are absolute. Emits a path relative to $1 that resolves to $2, using
# only canonicalized absolute prefixes (no realpath --relative-to, which is GNU).
rel_path() {
  _from=$(cd "$1" && pwd -P)
  _to_dir=$(cd "$(dirname "$2")" && pwd -P)
  _to="$_to_dir/$(basename "$2")"
  _common="$_from"
  _up=""
  while [ "${_to#"$_common"/}" = "$_to" ] && [ "$_common" != "/" ]; do
    _common=$(dirname "$_common")
    _up="../$_up"
  done
  if [ "$_common" = "/" ]; then
    _rest="${_to#/}"
  else
    _rest="${_to#"$_common"/}"
  fi
  printf '%s%s\n' "$_up" "$_rest"
}

# >>> manifest-managed symlinks (generated from docs.manifest.json at emit time)
# One link_file call per `source: "symlink"` page; native/unmanaged pages omitted.
{{SYMLINK_PAGE_LINES}}
# Directory symlink for images so `images/<x>.svg` resolves on GitHub and Starlight:
link_dir "{{IMAGES_SRC_DIR}}" "images"
# <<< manifest-managed symlinks

# --- Clear Astro's content cache so the build re-scans after relinking --------
rm -rf "$DOCS_PKG_DIR/.astro" "$DOCS_PKG_DIR/node_modules/.astro"

echo "Done."
```

### 2.1 Why a hand-rolled `rel_path` (no `realpath --relative-to`)

`realpath --relative-to` and `readlink -f` are GNU coreutils extensions absent on
macOS/BSD and busybox. To keep the script POSIX-portable (tech-spec §3.5), the
template ships a pure-`sh` `rel_path` that computes the relative path by walking up
common prefixes of two canonicalized absolute paths. This is the load-bearing
difference from the reference script, which hard-codes a `REL="../../../../.."`
literal tied to `packages/docs/src/content/docs` depth — the generator cannot
hard-code depth because `{{DOCS_PKG_DIR}}` varies per target repo.

### 2.2 Tokens consumed (all defined in `00-core-definitions.md §4.1` or derived)

| Token                      | Meaning / source                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------- |
| `{{DOCS_PKG_DIR}}`         | Docs package dir, repo-relative (`00 §4.1`). E.g. `docs` or `packages/docs`.                       |
| `{{DOCS_PKG_DIR_TO_ROOT}}` | The `../` chain from `{{DOCS_PKG_DIR}}` back to repo root, derived from `{{DOCS_PKG_DIR}}` depth (one `..` per path segment). E.g. `docs` → `..`; `packages/docs` → `../..`. Derived token; see note below. |
| `{{IMAGES_SRC_DIR}}`       | Repo-relative dir holding diagram/static images, default `docs/images` (or `{{DOCS_PKG_DIR}}/images` per interview). |
| `{{SYMLINK_PAGE_LINES}}`   | Agent-generated block of `link_file "<from>" "<slug>"` lines, one per `source: "symlink"` page (§2.3). Not in `00 §4.1`'s table because it is a generated block, not a scalar token — it is documented here. |

> `{{DOCS_PKG_DIR_TO_ROOT}}` is a **derived** token: the agent computes it
> mechanically from `{{DOCS_PKG_DIR}}` (count path segments → that many `..`),
> exactly as the reference script's `cd "$(dirname "$0")/.."` does for its fixed
> single-level depth. Because it is a pure function of `{{DOCS_PKG_DIR}}`, it adds
> no interview question and preserves byte-identical output (REQ-PORT-02). If a row
> is required in `00 §4.1` for token-coverage (`10-testing-strategy.md`), add it
> there as a derived token — see Warnings.

### 2.3 Generating `{{SYMLINK_PAGE_LINES}}` from the manifest (REQ-CONTENT-04)

The agent reads `docs.manifest.json` (`00-core-definitions.md §2`) and emits one
line **per page where `source == "symlink"` and `unmanaged != true`**:

```sh
link_file "<from>" "<slug>"
```

- `source: "native"` pages → **no line** (mixed mode authoring stays in the site).
- `unmanaged: true` pages → **no line** (escape hatch, `00 §2.3`; user manages them).
- Symlink/mixed modes use the identical template; the page set differs only by data.

Example — for the manifest in `00-core-definitions.md §2.1`, the generated block is:

```sh
# >>> manifest-managed symlinks ...
link_file "docs/intro.md" "intro"
# guides/setup is source: native  -> no line
# legacy is unmanaged             -> no line
link_dir "docs/images" "images"
# <<< manifest-managed symlinks
```

## 3. Relative-path symlinks (REQ-CONTENT-02, portability)

Every link is **relative**, never absolute. Relative links survive repo relocation
and clone-to-different-path, and — critically — make the same `images/<x>.svg`
reference resolve both when GitHub renders the source markdown and when Starlight
builds the site (canon §, mechanic 3). The `rel_path` helper (§2) is the single
place relativity is computed; both `link_file` and `link_dir` route through it.

A page nested under a slug directory (e.g. `slug: "guides/setup"`) gets its parent
directory created (`mkdir -p "$(dirname "$_dest")"`) and a correctly deepened
relative path — `rel_path` handles arbitrary destination depth, unlike the
reference script's fixed `$REL`.

## 4. No-dereference handling for the `images/` directory (tech-spec §3.5)

This is the single most error-prone mechanic in the layer and is called out in both
the canon (mechanic 3) and tech-spec §3.5.

- File links use `ln -sf` (force-replace). For a regular file this is safe on re-run.
- The **directory** link (`images/`) uses **`ln -sfn`** — `-n` is
  `--no-dereference`. Without `-n`, the second run encounters an existing symlink
  that *points at a directory*; `ln` follows it and drops the new link **inside** the
  target directory, producing `images/images` (and on a third run `images/images/images`).
  `-n` makes `ln` treat the existing symlink as a plain file and replace it in place,
  preserving idempotency.

POSIX note: `-n` is specified by POSIX for `ln`; `-f` is specified; combined `-sfn`
is portable across GNU, BSD, and busybox `ln`. (BSD `ln` also offers `-h` as a
synonym for `-n`; `-n` is the portable choice and matches the reference script.)

## 5. Idempotency contract (REQ-CONTENT-02, REQ-REL-01)

Running `setup-docs.sh` twice with an unchanged manifest MUST produce an identical
filesystem state and a **no-op git diff** (symlinks are content-addressed by their
target path in git, and the targets are byte-identical):

1. **File links** — `ln -sf "$_rel" "$_dest"` overwrites any existing link/file with
   the same relative target; second run rewrites the same bytes → no-op.
2. **Directory link** — `ln -sfn` (§4) replaces in place → no-op (the `-n` is what
   makes this true; without it the second run diverges).
3. **`mkdir -p`** — idempotent by definition.
4. **`.astro` cache clear** — `rm -rf` of a regenerated build cache; the cache is
   git-ignored, so its regeneration is the explicitly-allowed exception in REQ-REL-01
   ("modulo regenerated build caches").

This symlink-level idempotency is the foundation the whole-generator idempotency
(REQ-RERUN-01) builds on; `08-rerun-and-verification.md` owns the file-level
provenance/never-clobber policy that complements it.

## 6. Native vs mixed gating; `predev`/`prebuild` wiring (REQ-USE-01)

Per the component-selection model (`00-core-definitions.md §5`) and the template-group
table (`01-architecture-layout.md §2.2`), the `symlink/` group is emitted **only**
when `contentMode ∈ {symlink, mixed}`:

- **`native`** → `setup-docs.sh` is **not** written, and **no** `predev`/`prebuild`
  script entries are added to `package.json`. A purely-native, all-declined site
  contains zero content-layer files (the decline-all invariant, `00 §5`).
- **`symlink` / `mixed`** → in addition to writing `setup-docs.sh`, the agent adds
  these script entries to the core `package.json` template's `scripts` block (the
  core template, `03-core-site-and-manifest.md`, leaves a documented insertion point;
  this layer contributes the two lines):

  ```jsonc
  {
    "scripts": {
      "predev":   "sh ./setup-docs.sh",
      "prebuild": "sh ./setup-docs.sh"
    }
  }
  ```

  `predev`/`prebuild` are npm/pnpm/bun lifecycle pre-hooks: they run before `dev`
  and `build` respectively, so symlinks are always fresh before Astro reads the
  content collection. Invoked as `sh ./setup-docs.sh` (not `./setup-docs.sh`) to
  avoid depending on the executable bit surviving checkout on every platform, and to
  pin the POSIX-`sh` interpreter regardless of the file's shebang.

  If the **diagrams** component is also selected (`05-diagrams-component.md`), its
  prebuild snippet and this symlink prebuild are composed into a single `prebuild`
  by the agent (diagram generation first, then symlink relinking, so generated SVGs
  exist before `link_dir` runs over `images/`). The composition rule lives in
  `05-diagrams-component.md`; this doc requires only that the symlink step run last
  in any composed `prebuild`.

## 7. Symlink confinement to the repo tree (REQ-SEC-02)

Emitted symlinks MUST stay inside the target repo root; a `from` path may not escape
it via `..` or an absolute path. This layer enforces a **runtime** check at link time
(the `assert_inside_repo` helper, §2): it canonicalizes the resolved source
(`cd "$_dir" && pwd -P` follows `..` and intermediate symlinks) and refuses with a
nonzero exit if the result is not a descendant of `pwd -P`-canonicalized `$REPO_ROOT`.

This runtime guard is a defense-in-depth backstop. The **authoritative** safety
policy — validating `from` paths at manifest-authoring/emit time, the threat model,
and the full set of refused path shapes (absolute paths, `..` traversal, symlinked
intermediate dirs that escape) — is specified in **`08-rerun-and-verification.md`**.
This document defers to it and only guarantees the script will not *create* an
escaping link at runtime. See also REQ-SEC-01 (the generator writes only within the
target tree), enforced upstream at emit time.

## 8. Error handling

Every operation has a defined failure mode; the script uses `set -eu` so an
unhandled command failure or unset variable aborts immediately with nonzero exit,
which the `predev`/`prebuild` hook propagates as a build failure (REQ-VERIFY-02 —
surfaced, never masked, see `08-rerun-and-verification.md`).

| Condition                                              | Detection                                  | Behavior                                                                 |
| ------------------------------------------------------ | ------------------------------------------ | ----------------------------------------------------------------------- |
| `from` target file missing                             | `[ ! -f "$REPO_ROOT/$1" ]` in `link_file`  | Print `ERROR: symlink source file not found: <from>` naming the page; exit 1. |
| `images` source dir missing                            | `[ ! -d ... ]` in `link_dir`               | Print `ERROR: symlink source directory not found`; exit 1.              |
| `from` escapes repo root (`..`/absolute/symlink-out)   | `assert_inside_repo` case match            | Print `ERROR: refusing symlink target outside repo root` + resolved path; exit 1 (REQ-SEC-02). |
| Source parent dir does not exist                       | `[ ! -d "$_dir" ]` in `assert_inside_repo` | Print `ERROR: source directory does not exist`; exit 1.                  |
| Existing `images/` symlink on re-run                   | `ln -sfn` replaces in place                | No error — idempotent (§4). (A *missing* `-n` would silently corrupt — prevented by template.) |
| Broken/dangling link from a previous run               | `ln -sf`/`-sfn` overwrites the link entry  | Self-heals: the link is re-pointed to the (now validated) current target. |
| Unset `{{DOCS_PKG_DIR}}` (substitution miss)           | `set -u`                                    | Script aborts on first expansion of the empty path; fails the build loudly rather than linking into the wrong place. |
| `.astro` cache absent                                  | `rm -rf` of a nonexistent path             | No error (`rm -rf` is silent on missing paths) — safe.                   |

A dangling/orphaned symlink that remains because a page was *removed* from the
manifest is **not** cleaned up by `setup-docs.sh` (it only creates links for current
pages). Detecting orphaned symlinks is the drift guard's job
(`07-drift-guard.md`, "orphaned symlinks" rule, REQ-DRIFT-01).

## Dependencies

Implement these first:

- **`00-core-definitions.md`** — required. Provides: the `docs.manifest.json` shape
  and the `source`/`from`/`unmanaged` field contract (§2) this script is driven by;
  the `contentMode` field of the component-selection model (§5) that gates emission;
  the `{{DOCS_PKG_DIR}}` token (§4.1); the provenance-manifest contract (§3) under
  which `setup-docs.sh` is a tracked managed file.
- **`01-architecture-layout.md`** — required. Provides: the `symlink/` template-group
  placement (`references/templates/symlink/setup-docs.sh.tmpl`, §2.2), the emit-phase
  (Phase 4) and the run-`setup-docs` phase (Phase 5) this layer plugs into, and the
  `{{DOCS_PKG_DIR}}/src/content/docs` content-collection path.
- **`03-core-site-and-manifest.md`** — produces the `docs.manifest.json` this script
  consumes and owns the core `package.json` template into which §6 injects the
  `predev`/`prebuild` lines.

Cross-references (not strict prerequisites):

- **`08-rerun-and-verification.md`** — authoritative REQ-SEC-02 safety policy (§7),
  whole-generator idempotency/never-clobber, and build-failure surfacing.
- **`05-diagrams-component.md`** — `prebuild` composition when diagrams are also
  selected (§6); the `images/` dir must contain generated SVGs before relinking.
- **`07-drift-guard.md`** — orphaned-symlink detection for pages removed from the
  manifest (§8).

## Verification

How to confirm an implementation matches this spec:

- [ ] In `native` mode, the scaffold emits **no** `setup-docs.sh` and **no**
      `predev`/`prebuild` entries (assert in a native-mode scaffold-output fixture,
      `10-testing-strategy.md`).
- [ ] In `symlink`/`mixed` mode, `{{DOCS_PKG_DIR}}/setup-docs.sh` exists, is mode
      `0755`, begins with `#!/bin/sh`, and contains `set -eu` (not `set -euo pipefail`).
- [ ] The script contains no bash-only constructs (`[[`, arrays, `local`, `pipefail`);
      verify with `sh -n setup-docs.sh` (POSIX syntax check) and, if available,
      `shellcheck -s sh setup-docs.sh`.
- [ ] `{{SYMLINK_PAGE_LINES}}` contains exactly one `link_file` line per
      `source: "symlink"` page and **zero** for `native`/`unmanaged` pages (diff
      against the manifest in a mixed-mode fixture).
- [ ] The `images/` link uses `ln -sfn` (not `ln -sf`); grep asserts `-sfn` for the
      directory link.
- [ ] Running the script twice (in a sandbox repo with real `from` files) leaves an
      identical tree: `git status --porcelain` is empty after the second run modulo
      `.astro` (REQ-REL-01); specifically no `images/images` nesting appears.
- [ ] All created links are relative (`readlink <link>` returns a `../`-prefixed
      path, never an absolute path or a repo-root-anchored path).
- [ ] A page whose `from` points outside the repo (e.g. `from: "../../etc/passwd"`)
      causes the script to exit nonzero with the REQ-SEC-02 refusal message and
      creates no link.
- [ ] A page whose `from` file is missing causes a nonzero exit naming the page; the
      `predev`/`prebuild` hook propagates it as a build failure.
- [ ] After the script runs, `{{DOCS_PKG_DIR}}/.astro` is absent (cache cleared).
- [ ] In a monorepo target (`{{DOCS_PKG_DIR}} = packages/docs`),
      `{{DOCS_PKG_DIR_TO_ROOT}}` is `../..` and `REPO_ROOT` resolves to the repo root
      regardless of caller CWD.
