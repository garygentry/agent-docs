# Drift Guard Component (agent reference)

This reference covers the **drift-guard** template group — emitted only when the
component-selection record has `driftGuard: true` (`00 §5`). It
documents the single template asset
`references/templates/drift-guard/check-docs.mjs.tmpl`, how the agent wires the
`docs:check` script and the optional CI step during **Phase 4 (emit)**, and the
fork-free custom-rule convention.

`check-docs.mjs` is a stdlib-only ESM script that runs identically under `node` and
`bun` — it imports only from `node:fs`, `node:path`, and `node:url`, and derives all
runtime paths from `import.meta.url`, so the resolved script is location-independent
(works under `docs/`, `packages/docs/`, `docs-site/`, … without an extra token).

---

## 1. Gating: emit only when `driftGuard: true`

The `drift-guard/` group is emitted **iff** the selection record has
`driftGuard: true`. Nothing outside this group references it.

- **`driftGuard: true`** → emit `{{DOCS_PKG_DIR}}/check-docs.mjs`, add the
  `docs:check` script (§3), and — when CI + the GitHub Pages deploy target are
  selected — the optional pre-build CI step (§4).
- **`driftGuard: false`** → emit **nothing**: no `check-docs.mjs`, no `docs:check`
  script, no CI step, and no reference anywhere else. This is the decline-clean
  guarantee (REQ-USE-01) asserted by the decline-all scaffold-output fixture.
  The custom-rule file `docs.drift.rules.mjs` is
  **never** emitted by the generator either way — it is a user-authored convention
  (§5).

`check-docs.mjs` is a managed plumbing file: its sha256 is recorded in
`.doc-site-scaffold.json` (`00 §3`) so a re-run never clobbers a
user-edited copy (see `rerun.md`).

---

## 2. The single asset: `check-docs.mjs.tmpl`

The template `references/templates/drift-guard/check-docs.mjs.tmpl` is copied to
`{{DOCS_PKG_DIR}}/check-docs.mjs` after token substitution. The **only** token
it contains is `{{DOCS_PKG_DIR}}`, and that occurs **only inside a header comment**
(`// check-docs.mjs — docs drift guard for {{DOCS_PKG_DIR}}`). Every runtime path is
derived from `import.meta.url`, so the resolved script is byte-for-byte the same
regardless of where the docs package lives — substituting `{{DOCS_PKG_DIR}}` only
fills in the human-readable comment.

The script reads (no network — `REQ-SEC-03`):

| Path                                | Used by rule |
| ----------------------------------- | ------------ |
| `docs.manifest.json`                | 1, 2, 3, 4   |
| `astro.config.mjs` (sidebar)        | 2            |
| `src/content/docs/**` (pages/links) | 1, 3, 4      |
| `docs.drift.rules.mjs` (optional)   | custom       |

Before any drift rule runs, the guard performs a **manifest-validity** check:

- **`duplicate-slug`** — on manifest load, if any `slug` value repeats across
  `pages`, the guard prints
  `check-docs: [duplicate-slug] docs.manifest.json — slug 'X' appears N times`
  for each duplicate and **exits 2**. Slug-uniqueness (`00 §2.2` rule 5) cannot be
  expressed in JSON Schema (`uniqueItems` compares whole items, not one property),
  so the guard owns it. A duplicate slug is a **manifest error** (exit 2), the same
  class as a missing/invalid manifest — **not** a drift finding (exit 1). The agent
  also pre-checks slug-uniqueness during emit (`core.md` / `manifest-schema.md`,
  "validate before wiring").

It then applies four generic drift rules and exits:

- **`broken-link` (Rule 1)** — flags local Markdown/image links that do not resolve
  on disk, skipping external/anchor/`mailto:`/`tel:`/`data:` targets, with a
  Starlight slug-style fallback (`foo` → `foo.md` / `foo.mdx` / `foo/index.mdx`).
  Runs over **every** page on disk, including symlinked and `unmanaged` pages.
- **`sidebar-parity` (Rule 2)** — checks that `astro.config.mjs`'s generated sidebar
  lists exactly the **managed** manifest slugs, in manifest order. **`unmanaged`
  pages are exempt** — allow-listed, so they are never reported as missing-from or
  not-in the manifest (`00 §2.3`, OQ-2).
- **`orphaned-symlink` (Rule 3)** — flags dangling content-dir symlinks (target
  missing) **and** stale `source: "symlink"` manifest pages whose content-dir link
  is absent.
- **`missing-frontmatter` (Rule 4)** — flags any `.md`/`.mdx` page lacking a `title`
  frontmatter key (`REQUIRED_FRONTMATTER`, the Starlight minimum). Runs over every
  page, including `unmanaged` ones.

### 2.1 Exit codes & structured findings

`emitReportAndExit` prints a deterministic, grep-friendly report and sets the exit
code (`REQ-VERIFY-02`):

| Exit | Meaning                                                                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Clean — no findings (`check-docs: OK — no drift detected.`).                                                                                                                                    |
| `1`  | One or more drift findings; each printed as `[<rule>] <file>:<line> — <message>`, followed by a single machine-readable `check-docs-json: {…}` trailer for CI annotators.                       |
| `2`  | Manifest-validity error — `docs.manifest.json` missing, invalid JSON, or **duplicate slugs** (`duplicate-slug` rule). Distinct from exit 1 so CI can tell "drift found" from "manifest broken". |

---

## 3. `docs:check` script wiring (`package.json`, REQ-PORT-01)

When emitted, the agent adds a `docs:check` script to the docs package's
`package.json`, matched to the detected runtime via `{{RUNTIME}}` (∈ `{node, bun}`):

```jsonc
// {{DOCS_PKG_DIR}}/package.json — "scripts" (added only when driftGuard: true)
{
  "docs:check": "{{RUNTIME}} check-docs.mjs",
}
```

- If the repo already runs a **meta `gate`/`check` script** (detected per
  `detect.md`), the agent **appends** `docs:check` to it so
  drift fails the existing gate (e.g. `… && {{PKG_MANAGER}} run docs:check`).
- If no such meta script exists, `docs:check` is left as a standalone entry and
  surfaced in the next-steps output (see `rerun.md`,
  REQ-VERIFY-03).
- For monorepos, a root passthrough is added per the monorepo root-scripts fragment
  pattern (`monorepo.md`). The script is invoked with the detected
  package manager (`{{PKG_MANAGER}} run docs:check`).

---

## 4. Optional CI guard step (GitHub Pages, REQ-DRIFT-01)

When the repo has CI **and** the GitHub Pages deploy target is selected, the agent
injects the guard step into the emitted `.github/workflows/docs.yml` at the
`# <<DRIFT_STEP>>` sentinel (`deploy-github-pages.md`). The step body is the
dedicated fragment `templates/drift-guard/ci-step.github-pages.yaml.tmpl` (it uses
the derived `{{RUN_PREFIX}}` token), positioned **after the build (whose
`prebuild` ran `setup-docs.sh`) and before the deploy**, so a drifted or broken
page never ships. When `driftGuard` is not selected, the sentinel line is removed
and no step is emitted — the guard never leaks into the workflow.

**Ordering is load-bearing in symlink/mixed mode.** The symlinked page bodies under
`src/content/docs/**` are materialized by `setup-docs.sh` (run via the build's
`prebuild` hook). If `docs:check` runs **before** the symlinks exist, Rule 1
(`broken-link`) and Rule 3 (`orphaned-symlink`) fire on every page → false failure.
So the step must run after symlinks are in place. The self-contained form composes
`setup-docs.sh` directly:

```yaml
# .github/workflows/docs.yml — injected at the `# <<DRIFT_STEP>>` sentinel from
# templates/drift-guard/ci-step.github-pages.yaml.tmpl ({{RUN_PREFIX}} = the
# detected package manager's run prefix, e.g. `pnpm run` / `npm run`).
# symlink / mixed mode — make symlinks exist, then check:
- name: Docs drift guard
  run: sh setup-docs.sh && {{RUN_PREFIX}} docs:check
  working-directory: "{{DOCS_PKG_DIR}}"
# native mode — no symlinks; drop the `setup-docs.sh &&` prefix:
#   run: {{RUN_PREFIX}} docs:check
```

When there is no CI / no GitHub Pages target, only the `docs:check` script entry is
emitted (§3) — no workflow is created solely for the guard (REQ-USE-01).

---

## 5. Custom rules — `docs.drift.rules.mjs` (user convention, never emitted)

The guard imports an optional `{{DOCS_PKG_DIR}}/docs.drift.rules.mjs` **iff present**.
The generator **never** emits this file — it is a pure convention that lets a repo
add project-specific rules (grammar, branding, no-TODO, …) **without forking** the
shipped tool (REQ-DRIFT-02).

The module `export default`s an array of rule objects `{ id, run(ctx) }`. Each `run`
receives a context (`manifest`, `pages`, `managedPages`, `pageFiles`, `docsPkgDir`,
`contentDir`, `rel`, a read-only `fs`) and **returns** an array of
`Finding` (`{ rule, file, line, message }`); it must not call `process.exit`. A rule
may be `async` (the guard `await`s it), and a rule that **throws** is caught and
converted into a guard finding so a buggy rule fails the gate loudly rather than
passing silently.

```js
// docs.drift.rules.mjs (authored by the target repo's maintainer — NOT emitted)
export default [
  {
    id: "no-todo",
    run({ pageFiles, fs, rel }) {
      const findings = [];
      for (const file of pageFiles) {
        fs.readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (/\bTODO\b/.test(line))
              findings.push({
                file: rel(file),
                line: i + 1,
                message: "TODO left in published doc",
              });
          });
      }
      return findings; // `rule` defaults to this module's id ("no-todo")
    },
  },
];
```
