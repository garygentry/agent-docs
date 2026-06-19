# 02 — Detection & Interview

The first two phases of the generator's procedure: **Phase 1 (detect)** and **Phase 2
(interview)** from the `SKILL.md` phased procedure (`01-architecture-layout.md §4`). This
document specifies the network-free detection probe set, the graceful-degradation table
that turns every missing signal into a surfaced assumption, and the interview script that
fills every substitution token (`00-core-definitions.md §4.1`) and the component-selection
record (`00-core-definitions.md §5`).

The load-bearing principle of this subsystem: **detection is best-effort and never a hard
prerequisite.** Every parameter detection could not resolve is obtainable through the
interview with a suggested default (REQ-INT-02), and every degraded default is flagged to
the user (REQ-USE-02). The generator hard-fails (`HARD_FAIL_IMPOSSIBLE`,
`00-core-definitions.md §7`) only when scaffolding is genuinely impossible (REQ-DETECT-02).

The agent-facing *instruction text* for these two phases lives in the emitted reference
docs `skills/doc-site-plugin/references/detect.md` and
`skills/doc-site-plugin/references/interview.md` (`01-architecture-layout.md §1`). This
spec is the authoritative decision record those two reference docs must implement. Per
REQ-PORT-02, the *conversational phrasing* an agent uses to ask interview questions is
inherently agent-dependent and is explicitly **out of scope** for the byte-identity bar
(PRD REQ-PORT-02); what is in scope is the set of parameters captured, their defaults, and
the token/selection-record fields they fill.

## Requirement Coverage

| REQ / decision ID | Requirement / decision                                            | Section |
| ----------------- | ----------------------------------------------------------------- | ------- |
| REQ-DETECT-01     | Detect repo shape before interviewing (monorepo, PM, runtime, docs, CI, branch, slug) | §2 |
| REQ-DETECT-02     | Degrade gracefully on missing/ambiguous signals; hard-fail only when impossible | §3, §5 |
| REQ-INT-01        | Interview captures the minimum parameter set                       | §4.1, §4.2 |
| REQ-INT-02        | Every undetected parameter obtainable via interview with a default | §4.2, §4.3 |
| REQ-USE-02        | Every degraded assumption surfaced to the user                     | §3.2, §3.3 |
| REQ-USE-01 (supports) | Optional components are opt-in; decline-all stays minimal      | §4.4 |
| REQ-SEC-03 (supports) | Detection reads only target-repo files; no network            | §2.1 |

## 1. Purpose & Scope

**In scope:**
- The exact files and commands the agent reads to detect repo shape (§2).
- The fallback default and assumption code for every signal, and how each becomes an
  assumption record (§3).
- The interview script: every parameter, its detection-seeded default, and the
  token(s)/selection-record field it fills (§4).
- The handoff into Phase 3 (component-select) and the only legitimate hard-fail (§5).

**Out of scope (cross-referenced, not redefined here):**
- The token vocabulary itself → `00-core-definitions.md §4.1`.
- The component-selection record shape → `00-core-definitions.md §5`.
- The assumption-record shape and signal/default table → `00-core-definitions.md §6`.
- The outcome taxonomy (`HARD_FAIL_IMPOSSIBLE` etc.) → `00-core-definitions.md §7`.
- How tokens drive emitted files → `03-core-site-and-manifest.md` and the component docs.
- Conversational phrasing of questions (agent-dependent, REQ-PORT-02 out of scope).

## 2. Detection probes (Phase 1) (REQ-DETECT-01)

### 2.1 Constraints on all probes (REQ-SEC-03)

Every probe is a **read-only**, **network-free** operation against the target repo's
working tree. No probe transmits repo contents anywhere (REQ-SEC-03). The `git` probes are
local plumbing reads (`symbolic-ref`, `remote get-url`) that never contact a remote. All
paths below are **repo-relative POSIX paths** (`00-core-definitions.md §1`), resolved
against the target-repo root. A probe that errors (missing file, non-git tree, command
absent) is **not** fatal — it simply yields "absent," which routes to the degradation
table (§3).

### 2.2 Probe set

Each row gives the signal, the exact probe(s) in priority order, what an affirmative read
means, and the token(s)/selection field it seeds. Tokens are cited from
`00-core-definitions.md §4.1`; selection fields from `00-core-definitions.md §5`.

#### 2.2.1 Monorepo vs single package

```sh
# Priority 1: explicit pnpm workspace file at repo root
cat pnpm-workspace.yaml            # presence + a non-empty `packages:` list ⇒ monorepo
# Priority 2: npm/yarn/bun workspaces field in root package.json
cat package.json                   # a top-level "workspaces" array (or object) ⇒ monorepo
```

- Affirmative (`pnpm-workspace.yaml` present with `packages:`, **or** root `package.json`
  has `workspaces`) ⇒ `monorepo = true` (`00 §5`).
- Seeds: selection field `monorepo`; default for `{{DOCS_PKG_DIR}}` (`packages/docs/` when
  monorepo, `docs/` when single — `00 §4.1`).

#### 2.2.2 Package manager

```sh
cat package.json                   # read the "packageManager" field, e.g. "pnpm@9.1.0"
ls pnpm-lock.yaml                  # ⇒ pnpm
ls package-lock.json               # ⇒ npm
ls bun.lock                        # ⇒ bun   (also legacy bun.lockb if present)
ls yarn.lock                       # ⇒ yarn
```

- Priority: `packageManager` field (authoritative when present) → lockfile presence →
  absent. If multiple lockfiles exist, the `packageManager` field wins; otherwise prefer
  in order pnpm, bun, yarn, npm and **flag the ambiguity** (`ASSUME-PKGMGR-NPM` is only
  for the *absent* case — when multiple lockfiles disagree without a `packageManager`
  field, record an assumption naming the chosen manager).
- Seeds: `{{PKG_MANAGER}}` (`00 §4.1`); feeds emitted `package.json` and deploy CI.

#### 2.2.3 Runtime (Bun vs Node)

```sh
ls .bun-version                    # ⇒ Bun
ls bun.lock                        # ⇒ Bun (also implies bun PM)
cat package.json                   # read "engines.node" ⇒ Node
```

- Priority: `.bun-version` or `bun.lock` ⇒ `bun`; else `engines.node` present ⇒ `node`;
  else absent. A pnpm/npm lockfile without any Bun signal ⇒ `node`.
- Seeds: `{{RUNTIME}}` (`00 §4.1`); feeds deploy CI setup steps and emitted scripts.

#### 2.2.4 Existing docs markdown

```sh
ls docs/*.md                       # existing repo markdown to source as symlinked pages
ls CONTRIBUTING.md                 # a candidate top-level doc
```

- Affirmative (any `docs/*.md` or `CONTRIBUTING.md`) ⇒ existing docs present; the agent
  enumerates the matched files to **seed the markdown→sidebar-slug mapping** (§4.2,
  REQ-INT-01). Absent ⇒ no candidate symlink sources; default content mode leans
  `native`.
- Seeds: the `pages[]` proposal feeding `docs.manifest.json` (`00 §2`); default for
  `contentMode` (`00 §5`).

#### 2.2.5 Existing CI

```sh
ls .github/workflows/*.yml .github/workflows/*.yaml   # existing workflows
```

- Affirmative ⇒ CI exists; if GitHub Pages is later selected, the generator emits
  `.github/workflows/docs.yml` as a **new, path-filtered** workflow alongside existing
  ones (it does not edit foreign workflows). Absent ⇒ emit a fresh workflow only if GH
  Pages is chosen.
- Seeds: informs the GH-Pages deploy component (`06-deploy-and-monorepo.md`); no direct token.

#### 2.2.6 Default branch

```sh
git symbolic-ref refs/remotes/origin/HEAD   # e.g. "refs/remotes/origin/main" ⇒ "main"
git branch --show-current                   # fallback: current local branch
```

- Priority: `origin/HEAD` symbolic-ref (strip the `refs/remotes/origin/` prefix) →
  current local branch → absent. On absent, the agent **asks** and defaults to `main`.
- Seeds: `{{DEFAULT_BRANCH}}` (`00 §4.1`); feeds GH-Pages workflow triggers.

#### 2.2.7 Repo slug / remote

```sh
git remote get-url origin          # e.g. git@github.com:acme/myproject.git ⇒ "acme/myproject"
```

- Parse the `owner/name` slug from common URL forms (`git@host:owner/name.git`,
  `https://host/owner/name(.git)`). Absent or unparseable ⇒ **ask the user** (REQ-INT-02).
- Seeds: `{{REPO_SLUG}}`, and `{{GITHUB_URL}}` derived as
  `https://github.com/{{REPO_SLUG}}` (`00 §4.1`); feeds social links and GH-Pages deploy.

### 2.3 Detection output

Phase 1 produces two artifacts consumed by Phase 2:

1. A **detected-values map** seeding the token defaults and selection record (the cells in
   §2.2 marked "Seeds").
2. A **list of assumption records** (`00-core-definitions.md §6.2`), one per signal that
   fell back to a default (§3). These are advisory output, not persisted to the target tree
   (`00 §6.2`), and are surfaced in the final summary (REQ-USE-02, §3.3).

Detection completes regardless of how many signals are absent; it never blocks the
interview (REQ-INT-02).

## 3. Graceful-degradation table (REQ-DETECT-02, REQ-USE-02)

### 3.1 Signal → fallback → assumption code

This mirrors and details `00-core-definitions.md §6.1`. For each signal that the §2 probes
could not resolve affirmatively, the generator proceeds with the fallback default and emits
one assumption record carrying the code below.

| Signal              | Probe(s) (§2)     | Fallback default                     | Assumption code (`00 §6.1`) |
| ------------------- | ----------------- | ------------------------------------ | --------------------------- |
| monorepo vs single  | §2.2.1            | single-package (`monorepo = false`)  | `ASSUME-MONOREPO-SINGLE`    |
| package manager     | §2.2.2            | `npm` (sets `{{PKG_MANAGER}}=npm`)   | `ASSUME-PKGMGR-NPM`         |
| runtime             | §2.2.3            | `node` (sets `{{RUNTIME}}=node`)     | `ASSUME-RUNTIME-NODE`       |
| existing docs       | §2.2.4            | none → default `contentMode=native`  | `ASSUME-NO-DOCS`            |
| existing CI         | §2.2.5            | none → emit fresh workflow if GH Pages chosen | `ASSUME-NO-CI`     |
| default branch      | §2.2.6            | `main` (after asking)                | `ASSUME-BRANCH-MAIN`        |
| repo slug / remote  | §2.2.7            | ask the user                         | `ASSUME-SLUG-ASKED`         |

Notes:
- `ASSUME-NO-DOCS` only sets the *default* content mode; the user may still choose
  `symlink`/`mixed` and supply paths manually in the interview (REQ-INT-02).
- `ASSUME-SLUG-ASKED` / `ASSUME-BRANCH-MAIN` denote "had to ask" — they are recorded so the
  user sees that the value came from them, not from detection.

### 3.2 Becoming an assumption record (REQ-USE-02)

When a fallback in §3.1 is applied, the generator constructs an assumption record exactly
in the shape defined in `00-core-definitions.md §6.2`:

```jsonc
{
  "code": "ASSUME-PKGMGR-NPM",
  "signal": "package manager",
  "chose": "npm",
  "because": "no lockfile or packageManager field found"
}
```

The `code` is the §3.1 code; `signal` is the §3.1 signal label; `chose` is the resolved
value; `because` states the missing/ambiguous probe result. The records accumulate across
detection into the list described in §2.3.

### 3.3 Surfacing assumptions (REQ-USE-02)

Every accumulated assumption record MUST be surfaced to the user. Two surfacing points:

1. **At interview time** — when an interview question's default came from a fallback rather
   than a positive detection (e.g. the proposed `{{PKG_MANAGER}}` is `npm` because no
   lockfile was found), the question presents the value as an assumption the user can
   confirm or override (this is how `00 §6` "flagged" defaults reach the user before
   emission).
2. **In the final summary** — the Phase 7 "next steps" output (`08-rerun-and-verification.md`,
   REQ-VERIFY-03) reprints the full list of assumption records, so even silently-confirmed
   assumptions remain visible in the run summary.

An assumption confirmed or overridden in the interview is still listed in the summary with
its final resolved value, so the user has a complete audit of what detection guessed.

## 4. Interview script (Phase 2) (REQ-INT-01, REQ-INT-02)

The interview is conversational and agent-driven (CON-03). It captures every parameter the
substitution table (`00-core-definitions.md §4.1`) and the component-selection record
(`00-core-definitions.md §5`) need. Each question carries a **suggested default seeded from
detection** (§2.3); the user accepts or overrides. Because every default exists, the
interview alone is sufficient to fill all parameters even with zero detection signals
(REQ-INT-02).

### 4.1 Minimum required parameter set (REQ-INT-01)

REQ-INT-01 mandates that the interview capture, at minimum, the following. The table maps
each to its token(s) / selection-record field and its detection-seeded default.

| # | Parameter (REQ-INT-01)        | Fills token(s) / field (`00 §4.1`, `00 §5`)         | Default (seeded from §2)                                     |
| - | ----------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| 1 | Site title                    | `{{SITE_TITLE}}`                                     | repo name (from §2.2.7 slug, titlecased) else dir name      |
| 2 | Site description              | `{{SITE_DESC}}`                                      | `"Documentation for {{SITE_TITLE}}"`                        |
| 3 | Social links                  | `{{GITHUB_URL}}` (+ `manifest.site.social`)          | `https://github.com/{{REPO_SLUG}}` from §2.2.7; else `""`   |
| 4 | Content-sourcing mode         | selection field `contentMode` (`symlink`/`native`/`mixed`) | `symlink` if §2.2.4 found docs; else `native` (`ASSUME-NO-DOCS`) |
| 5 | Markdown→sidebar-slug mapping | `manifest.pages[]` in `docs.manifest.json` (`00 §2`) | one `pages[]` entry per `docs/*.md` found in §2.2.4 (slug = filename sans ext) |
| 6 | Deploy target(s)              | selection field `deploy[]`; `{{SITE_URL}}`, `{{BASE_PATH}}` | `[]` (none) — opt-in (REQ-USE-01)                    |
| 7 | Accent colors / brand         | `{{ACCENT_LIGHT}}`, `{{ACCENT_DARK}}`               | canon default accents (`.reference/canon.md`; `00 §4.1`)    |
| 8 | Docs-package location         | `{{DOCS_PKG_DIR}}`                                   | `packages/docs/` if monorepo (§2.2.1), else `docs/`         |

### 4.2 Parameter → token / selection-field mapping (detail)

Each interview answer maps mechanically onto a token or selection-record field. No answer
is left without a destination; no token in `00 §4.1` lacks a source (interview or
detection).

**Site identity (questions 1–3):**
- Title → `{{SITE_TITLE}}` → used by core `astro.config.mjs` and `index.mdx`, and written
  to `manifest.site.title` (`00 §2.2`).
- Description → `{{SITE_DESC}}` → `manifest.site.description`.
- Social: the GitHub URL → `{{GITHUB_URL}}` and `manifest.site.social.github` (`00 §2.2`).
  Additional social platforms (the user may add more) become further `manifest.site.social`
  keys — Starlight social-icon names mapped to URLs (`00 §2.2`).

**Content sourcing (questions 4–5):**
- Mode → selection field `contentMode` (`00 §5`). Drives whether the `symlink/` template
  group is emitted (`01-architecture-layout.md §2.2`).
- Mapping → `manifest.pages[]`. For each markdown file the user maps, the agent records a
  page entry per the `PageEntry` contract (`00 §2.2`):
  - `symlink` page → `{ "slug": "<slug>", "source": "symlink", "from": "<repo-rel path>" }`
  - `native` page → `{ "slug": "<slug>", "source": "native" }`
  - In `mixed` mode the per-page `source` is chosen page-by-page (REQ-CONTENT-04 expressed
    via `00 §2`). The agent may propose slugs from filenames (§2.2.4) and let the user
    rename. Page order in the array **is** sidebar order (`00 §2.2`).

**Deploy (question 6):**
- Chosen subset → selection field `deploy[]` ⊆ `["github-pages","vercel","static-netlify"]`
  (`00 §5`). Empty by default (opt-in, REQ-USE-01).
- The chosen target(s) seed `{{SITE_URL}}` and `{{BASE_PATH}}` (`00 §4.1`): GitHub Pages on
  a project subpath ⇒ `{{BASE_PATH}}` = `/<repo>/`, `{{SITE_URL}}` =
  `https://<owner>.github.io`; Vercel/static at root ⇒ `{{BASE_PATH}}` = `""`, `{{SITE_URL}}`
  = production URL (the env-driven mechanism is detailed in `06-deploy-and-monorepo.md`). When no
  deploy target is chosen, both default to `""` (env-driven at build, `00 §4.1`).

**Brand (question 7):**
- Light accent → `{{ACCENT_LIGHT}}`; dark accent → `{{ACCENT_DARK}}` → core
  `custom.css` (`03-core-site-and-manifest.md`). Defaults are the canon accents.

**Location (question 8):**
- Docs-package dir → `{{DOCS_PKG_DIR}}` → the path prefix every emitted plumbing file is
  written under (all paths, `00 §4.1`).

**Detection-only tokens (not asked unless overridden):** `{{PKG_MANAGER}}`, `{{RUNTIME}}`,
`{{REPO_SLUG}}`, `{{DEFAULT_BRANCH}}` are seeded from §2 and surfaced as confirmable
assumptions (§3.3) rather than open questions; the user may override any. `{{ASTRO_VERSION}}`
/ `{{STARLIGHT_VERSION}}` are resolved at scaffold time, not interviewed
(`00 §4.1`; version policy in `08-rerun-and-verification.md`).

### 4.3 Undetected-parameter guarantee (REQ-INT-02)

For every signal that detection could not resolve (§3.1), the corresponding parameter is
still reachable: questions 1–8 each have a non-detection default (§4.1), and the
detection-only tokens fall back to the §3.1 defaults and are presented as overridable
assumptions (§3.3). Therefore **no parameter requires a successful detection** — detection
strictly improves defaults, it is never a gate (REQ-DETECT-02, REQ-INT-02). Concretely: a
brand-new repo with no remote, no lockfile, and no `docs/` still completes the interview
using `ASSUME-*` defaults plus user input.

### 4.4 Optional-component questions stay opt-in (REQ-USE-01, supports)

Optional components — diagrams (`05-diagrams-component.md`), additional deploy targets
beyond a single chosen host (`06-deploy-and-monorepo.md`), and the drift guard
(`07-drift-guard.md`) — default to **declined** in the selection record (`diagrams=false`,
`deploy=[]`, `driftGuard=false`; `00 §5`). The interview asks about them but never forces
them. When the user declines every optional component and chooses `contentMode="native"`,
the selection record triggers the decline-all invariant (`00 §5`): only the core scaffold is
emitted. This document's responsibility is solely to **capture** those opt-in choices into
the selection record; emission gating is owned by `01-architecture-layout.md §2.2` and the
component docs.

### 4.5 Worked example

Target: a single-package Bun+pnpm repo with `docs/intro.md`, `docs/setup.md`, a
`pnpm-lock.yaml`, `.bun-version`, and remote `git@github.com:acme/widget.git` on default
branch `main`.

Detection (§2) yields:
- `monorepo=false` (no workspaces) — *positively* detected, no assumption.
- `{{PKG_MANAGER}}=pnpm` (lockfile) — detected.
- `{{RUNTIME}}=bun` (`.bun-version`) — detected.
- existing docs: `docs/intro.md`, `docs/setup.md` — detected.
- `{{DEFAULT_BRANCH}}=main` (`origin/HEAD`) — detected.
- `{{REPO_SLUG}}=acme/widget`, `{{GITHUB_URL}}=https://github.com/acme/widget` — detected.
- no `.github/workflows/*` → assumption `ASSUME-NO-CI`.

Interview defaults presented:
- `{{SITE_TITLE}}` = `Widget`; `{{SITE_DESC}}` = `Documentation for Widget`.
- `contentMode` default `symlink` (docs found); proposed `pages[]`:
  `[{ "slug":"intro","source":"symlink","from":"docs/intro.md" },
    { "slug":"setup","source":"symlink","from":"docs/setup.md" }]`.
- `{{DOCS_PKG_DIR}}` = `docs/` (single-package).
- accents = canon defaults; deploy = `[]` until the user opts in.

If the user selects GitHub Pages, `{{BASE_PATH}}` = `/widget/` and `deploy=["github-pages"]`;
`ASSUME-NO-CI` justifies emitting a fresh `.github/workflows/docs.yml`. The final summary
(§3.3) lists `ASSUME-NO-CI`.

## 5. Error / hard-fail handling (REQ-DETECT-02)

The detection/interview phases are tolerant by construction:

- **Missing or ambiguous signals** → degrade per §3; record an assumption; continue. Never
  fatal (REQ-DETECT-02).
- **No git / no remote** → §2.2.6–§2.2.7 fall back to asking; `ASSUME-BRANCH-MAIN` /
  `ASSUME-SLUG-ASKED`. Not fatal.
- **Conflicting lockfiles** → §2.2.2 resolves by priority and records an assumption naming
  the chosen manager. Not fatal.
- **The only legitimate hard-fail** is `HARD_FAIL_IMPOSSIBLE` (`00-core-definitions.md §7`):
  scaffolding is genuinely impossible — e.g. the target tree is not writable, or there is no
  target tree to write into. In that single case the generator stops and reports why; it
  does **not** invent a workspace. Detection ambiguity is explicitly **not** a hard-fail
  trigger (REQ-DETECT-02).

`SCHEMA_VIOLATION`, `BUILD_RED`, `PARTIAL_EMISSION`, and `RERUN_SKIP`
(`00-core-definitions.md §7`) belong to later phases and are out of scope here; the
detection/interview phases produce only a detected-values map, a selection record, a
proposed manifest, and a list of assumption records for those phases to consume.

## Dependencies

- **`00-core-definitions.md`** — the token vocabulary (§4.1), the `docs.manifest.json`
  `PageEntry` contract (§2), the component-selection record (§5), the detection-signal /
  assumption-record model (§6), and the outcome taxonomy incl. `HARD_FAIL_IMPOSSIBLE`
  (§7). This document fills those contracts; it does not redefine them.
- **`01-architecture-layout.md`** — the phased `SKILL.md` procedure (§4, Phases 1–2), the
  template-group ↔ component gating (§2.2) that consumes the selection record produced
  here, and the placement of the emitted `references/detect.md` / `references/interview.md`
  instruction docs (§1).

Must be implemented before this document's emitted instruction docs are authored.

## Verification

- [ ] `references/detect.md` performs every probe in §2.2 (exact files/commands) and is
      network-free (no probe contacts a remote; REQ-SEC-03).
- [ ] Each probe-absent path produces an assumption record matching §3.1's code and the
      `00 §6.2` shape (asserted against a fixture repo with the signal removed).
- [ ] A fixture target repo with **zero** detection signals (no git, no lockfile, no
      `docs/`) completes the interview to a full token set + selection record using only
      `ASSUME-*` defaults plus supplied answers (REQ-INT-02).
- [ ] `references/interview.md` captures all 8 REQ-INT-01 parameters (§4.1) and each maps to
      the token/selection-field named in §4.2; every `00 §4.1` token has a source.
- [ ] The selection record defaults to `diagrams=false`, `deploy=[]`, `driftGuard=false`,
      and `contentMode` follows §4.1 default rules (REQ-USE-01 opt-in; cross-checked against
      the decline-all invariant in `00 §5`).
- [ ] Every applied assumption appears both at interview time and in the final summary
      (REQ-USE-02; §3.3).
- [ ] The only outcome that halts these phases is `HARD_FAIL_IMPOSSIBLE` for a
      non-writable / absent target tree (§5; REQ-DETECT-02).
- [ ] The worked example (§4.5) reproduces the stated token values and assumption list when
      run against an equivalent fixture.
