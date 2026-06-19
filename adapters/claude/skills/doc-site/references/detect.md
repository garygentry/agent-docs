# detect.md — Phase 1: detection probes

This is the agent-facing procedure for **Phase 1 (detect)** of the `doc-site`
skill. It implements the decision record in `specs/doc-site-plugin/02-detection-and-interview.md`
and the detection-signal / assumption model in `specs/doc-site-plugin/00-core-definitions.md §6`.

**The load-bearing principle: detection is best-effort and never a hard prerequisite.**
Every value detection could not resolve is still reachable through the interview (Phase 2,
`interview.md`) with a suggested default. The only legitimate hard-fail is
`HARD_FAIL_IMPOSSIBLE` — the target tree is absent or not writable (`00 §7`). Detection
ambiguity is **never** a hard-fail.

## Constraints on every probe

Every probe below is:

- **Read-only** — it never writes to the target tree.
- **Network-free** — it never contacts a remote. The `git` probes are local plumbing
  reads (`symbolic-ref`, `remote get-url`) that resolve from `.git/` without touching the
  network. No probe transmits repo contents anywhere.

All paths are **repo-relative POSIX paths**, resolved against the target-repo root. A probe
that errors (missing file, non-git tree, command absent) is **not** fatal — it yields
"absent," which routes to the graceful-degradation table below.

## Probe set (7 probes)

Run all probes, in any order. Each produces either a detected value (seeds an interview
default) or "absent" (routes to the degradation table). None block the interview.

### Probe 1 — monorepo vs single package

```sh
cat pnpm-workspace.yaml   # Priority 1: presence + a non-empty `packages:` list ⇒ monorepo
cat package.json          # Priority 2: a top-level "workspaces" array/object ⇒ monorepo
```

Affirmative (`pnpm-workspace.yaml` present with `packages:`, **or** root `package.json` has
a `workspaces` field) ⇒ `monorepo = true`. Seeds the selection-record field `monorepo` and
the default for `{{DOCS_PKG_DIR}}` (`packages/docs/` when monorepo, `docs/` when single).

### Probe 2 — package manager

```sh
cat package.json          # read the "packageManager" field, e.g. "pnpm@9.1.0" (authoritative)
ls pnpm-lock.yaml         # ⇒ pnpm
ls bun.lock               # ⇒ bun  (also legacy bun.lockb if present)
ls yarn.lock              # ⇒ yarn
ls package-lock.json      # ⇒ npm
```

Priority: the `packageManager` field (authoritative when present) → lockfile presence →
absent. If multiple lockfiles exist without a `packageManager` field, prefer in order
**pnpm, bun, yarn, npm** and record an assumption naming the chosen manager. Seeds
`{{PKG_MANAGER}}`.

### Probe 3 — runtime (Bun vs Node)

```sh
ls .bun-version           # ⇒ bun
ls bun.lock               # ⇒ bun (also implies the bun package manager)
cat package.json          # read "engines.node" ⇒ node
```

Priority: `.bun-version` or `bun.lock` ⇒ `bun`; else `engines.node` present ⇒ `node`; else
absent. A pnpm/npm lockfile with no Bun signal ⇒ `node`. Seeds `{{RUNTIME}}`.

### Probe 4 — existing docs markdown

```sh
ls docs/*.md              # existing repo markdown to source as symlinked pages
ls CONTRIBUTING.md        # a candidate top-level doc
```

Affirmative (any `docs/*.md` or `CONTRIBUTING.md`) ⇒ existing docs present; enumerate the
matched files to **seed the markdown→sidebar-slug mapping** (interview question 5). Absent ⇒
no candidate symlink sources; the default content mode leans `native`. Seeds the proposed
`pages[]` for `docs.manifest.json` and the default `contentMode`.

### Probe 5 — existing CI

```sh
ls .github/workflows/*.yml .github/workflows/*.yaml   # existing workflows
```

Affirmative ⇒ CI exists; if GitHub Pages is later selected, emit `.github/workflows/docs.yml`
as a **new, path-filtered** workflow alongside existing ones — never edit foreign workflows.
Absent ⇒ emit a fresh workflow only if GH Pages is chosen. Informs the GH-Pages deploy
component; no direct token.

### Probe 6 — default branch

```sh
git symbolic-ref refs/remotes/origin/HEAD   # e.g. "refs/remotes/origin/main" ⇒ "main"
git branch --show-current                   # fallback: current local branch
```

Priority: `origin/HEAD` symbolic-ref (strip the `refs/remotes/origin/` prefix) → current
local branch → absent. On absent, **ask** the user and default to `main`. Seeds
`{{DEFAULT_BRANCH}}`.

### Probe 7 — repo slug / remote

```sh
git remote get-url origin   # e.g. git@github.com:acme/myproject.git ⇒ "acme/myproject"
```

Parse the `owner/name` slug from common URL forms (`git@host:owner/name.git`,
`https://host/owner/name(.git)`). Absent or unparseable ⇒ **ask** the user. Seeds
`{{REPO_SLUG}}` and `{{GITHUB_URL}}` (derived as `https://github.com/{{REPO_SLUG}}`).

## Detection output

Phase 1 produces two artifacts for Phase 2 to consume:

1. A **detected-values map** seeding the token defaults and the selection record.
2. A **list of assumption records** (`00 §6.2`), one per signal that fell back to a default.
   These are advisory output, surfaced to the user (interview time + final summary,
   REQ-USE-02) and **never persisted** to the target tree.

Detection completes regardless of how many signals are absent; it never blocks the interview.

## Graceful-degradation table

For each signal the probes could not resolve affirmatively, proceed with the fallback
default and emit **one** assumption record carrying the code below (`00 §6.1`).

| Signal             | Probe   | Fallback default                              | Assumption code          |
| ------------------ | ------- | --------------------------------------------- | ------------------------ |
| monorepo vs single | Probe 1 | single-package (`monorepo = false`)           | `ASSUME-MONOREPO-SINGLE` |
| package manager    | Probe 2 | `npm` (`{{PKG_MANAGER}}=npm`)                 | `ASSUME-PKGMGR-NPM`      |
| runtime            | Probe 3 | `node` (`{{RUNTIME}}=node`)                   | `ASSUME-RUNTIME-NODE`    |
| existing docs      | Probe 4 | none → default `contentMode=native`           | `ASSUME-NO-DOCS`         |
| existing CI        | Probe 5 | none → emit fresh workflow if GH Pages chosen | `ASSUME-NO-CI`           |
| default branch     | Probe 6 | `main` (after asking)                         | `ASSUME-BRANCH-MAIN`     |
| repo slug / remote | Probe 7 | ask the user                                  | `ASSUME-SLUG-ASKED`      |

Notes:

- `ASSUME-NO-DOCS` only sets the _default_ content mode; the user may still choose
  `symlink`/`mixed` and supply paths manually in the interview.
- `ASSUME-SLUG-ASKED` / `ASSUME-BRANCH-MAIN` mean "had to ask" — recorded so the user sees
  the value came from them, not detection.
- The package-manager probe also records an assumption when multiple lockfiles disagree
  without a `packageManager` field (naming the chosen manager); `ASSUME-PKGMGR-NPM` proper
  is the _absent_ case.

## Becoming an assumption record

When a fallback is applied, construct an assumption record in the exact shape from `00 §6.2`:

```jsonc
{
  "code": "ASSUME-PKGMGR-NPM",
  "signal": "package manager",
  "chose": "npm",
  "because": "no lockfile or packageManager field found",
}
```

`code` is the table code; `signal` is the table signal label; `chose` is the resolved value;
`because` states the missing/ambiguous probe result. Accumulate every record into the list
that Phase 2 and Phase 7 surface to the user (REQ-USE-02).

## Hard-fail handling

The detection phase is tolerant by construction:

- **Missing / ambiguous signals** → degrade per the table; record an assumption; continue.
  Never fatal.
- **No git / no remote** → Probes 6–7 fall back to asking (`ASSUME-BRANCH-MAIN`,
  `ASSUME-SLUG-ASKED`). Not fatal.
- **Conflicting lockfiles** → Probe 2 resolves by priority and records an assumption. Not
  fatal.
- **The only legitimate hard-fail** is `HARD_FAIL_IMPOSSIBLE`: the target tree is not
  writable, or there is no target tree to write into. Stop and report why; do **not** invent
  a workspace. Detection ambiguity is explicitly **not** a hard-fail trigger.
