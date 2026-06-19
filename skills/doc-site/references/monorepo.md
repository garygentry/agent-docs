# Monorepo portability — `monorepo/` group

Emitted **iff** `monorepo = true` in the selection record (`00 §5`, seeded by
detection `02`). Template group: `templates/monorepo/`. For a single-package
target the group is skipped entirely (REQ-USE-01): there is no workspace manifest
to register into, and the docs package's own scripts (owned by `03`) suffice
(06 §7).

This group is **additive merges into pre-existing user files**, not full-file
plumbing copies — see _Merge semantics_ below.

## Tokens consumed (all from `00 §4.1`)

| Token              | Role                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `{{DOCS_PKG_DIR}}` | The docs package path registered as a workspace member + used in the passthrough script forms. |
| `{{PKG_MANAGER}}`  | Selects the workspace registry and the script fragment (`pnpm` vs `npm`).                      |

## Package-manager matching (REQ-PORT-01)

The registration target depends on the detected package manager:

| `{{PKG_MANAGER}}` | Workspace registry                       | Fragment(s) emitted                                                                                               |
| ----------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm`            | `pnpm-workspace.yaml` (`packages:` list) | `pnpm-workspace.fragment.yaml.tmpl` (membership) + the pnpm `scripts` keys from `root-scripts.fragment.json.tmpl` |
| `npm`             | root `package.json` `workspaces` array   | `root-scripts.fragment.json.tmpl` (npm fragment: `workspaces` + `scripts`)                                        |

## The fragments

**`pnpm-workspace.fragment.yaml.tmpl`** — the entry to ensure exists in
`pnpm-workspace.yaml` `packages:`:

```yaml
packages:
  - "{{DOCS_PKG_DIR}}"
```

**`root-scripts.fragment.json.tmpl`** — the keys to merge into the root
`package.json`. It carries **both** passthrough forms; the agent selects one by
`{{PKG_MANAGER}}` (no in-template logic — `00 §4`):

- **npm form** (carries `workspaces` membership):

  ```json
  {
    "workspaces": ["{{DOCS_PKG_DIR}}"],
    "scripts": {
      "dev:docs": "npm run dev --workspace {{DOCS_PKG_DIR}}",
      "build:docs": "npm run build --workspace {{DOCS_PKG_DIR}}"
    }
  }
  ```

- **pnpm form** (no `workspaces` — pnpm uses `pnpm-workspace.yaml`; only the
  `scripts` keys merge):

  ```json
  {
    "scripts": {
      "dev:docs": "pnpm --filter ./{{DOCS_PKG_DIR}} dev",
      "build:docs": "pnpm --filter ./{{DOCS_PKG_DIR}} build"
    }
  }
  ```

These passthroughs make the docs site a **first-class workspace member**
invokable from the repo root (REQ-PORT-03).

## Merge semantics & re-run (additive-merge / RERUN_SKIP, 06 §7.4)

Because these fragments merge into **pre-existing user files**, they are handled
differently from full-file plumbing (§3–§5 deploy files):

1. **Register membership idempotently** — add `{{DOCS_PKG_DIR}}` to the workspace
   list only if not already present (string-equality on the POSIX-relative path).
   A second run is a no-op (REQ-REL-01).
2. **Add passthrough scripts** — set `scripts.dev:docs` / `scripts.build:docs`.
   If a key already exists with a **different** value (user-edited), apply the
   **never-clobber** rule: skip + flag (`RERUN_SKIP`, `00 §7`; decision table
   `00 §3.3`) rather than overwrite. Never clobber a user-edited script value.
3. The root `package.json` / `pnpm-workspace.yaml` are **not** wholesale-tracked
   in `.doc-site-scaffold.json` `files` (they are user-owned root files); only the
   _generator-managed keys_ are reconciled, per the re-run policy in `rerun.md`.

## Errors (06 §7.5)

| Condition                                       | Behavior                                                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No root `package.json` in a detected monorepo   | Surface `ASSUME-MONOREPO-SINGLE` reconsideration (`00 §6.1`), or create a minimal root manifest with just the merged keys, flagged to the user (REQ-USE-02). |
| `pnpm-workspace.yaml` malformed YAML            | Do not silently rewrite; report a `PARTIAL_EMISSION`-style flag (`00 §7`) for that step and leave the file untouched.                                        |
| Passthrough script collides with a user value   | `RERUN_SKIP` (step 2) — never clobber.                                                                                                                       |
| Detected pkg manager mismatches actual lockfile | Detection (`02`) resolves authoritatively; this group consumes `{{PKG_MANAGER}}` and emits the matching registry only (REQ-PORT-01).                         |
