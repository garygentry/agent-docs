# 08 — Re-run, Version Resolution, Safety & Verification

The lifecycle/safety subsystem of `doc-site-plugin`: how the generator writes its
provenance manifest during emission, how it re-runs against an
already-scaffolded repo without clobbering user edits, how it resolves and pins
Astro/Starlight versions, the authoritative write/symlink/network **safety
policy**, and the build smoke test that gates success. This document is the
load-bearing decision record for the generator's *completion contract*: the
agent procedure (`SKILL.md` Phases 4, 6, 7 — `01-architecture-layout.md §4`) and
the `references/rerun.md` reference doc both implement what is specified here.

This feature is a **canonical skill** (markdown orchestration + parameterized
template assets), not TypeScript implementation code (`00-core-definitions.md §1`).
Accordingly the "code" in this document is the **exact shell/CLI commands** the
agent runs (`sha256sum`/`shasum`, `ln`, `npm view`, the emitted build command) and
the **decision algorithms** the agent follows. There is no in-repo runtime module
for this subsystem; the in-repo verification surface (`10-testing-strategy.md`)
asserts the *templates* and *scaffold outputs* this document governs, but the
re-run/build behavior runs at scaffold time in the target repo.

## Requirement Coverage

| REQ / decision ID | Requirement                                                              | Section |
| ----------------- | ----------------------------------------------------------------------- | ------- |
| REQ-RERUN-01      | Safe re-run; preserve existing version pins (no re-resolve on re-run)    | §3, §5  |
| REQ-RERUN-02      | Never overwrite user-edited files; native pages always preserved        | §2, §3  |
| REQ-REL-01        | Idempotent: second identical run = no-op git diff (modulo build caches)  | §4      |
| REQ-REL-02        | Resolve latest Astro/Starlight at first scaffold; write resolved pins    | §5      |
| REQ-VERIFY-01     | Run emitted build (content setup + site build) as a green smoke test     | §7      |
| REQ-VERIFY-02     | On build failure: report failure + remediation, never success           | §7.3    |
| REQ-VERIFY-03     | On success: print next steps (run / preview / deploy)                    | §7.4    |
| REQ-VERIFY-04     | Partial emission: no rollback; flag partial state + name failed step     | §8      |
| REQ-SEC-01        | Generator writes only within the target repo tree                       | §6.1    |
| REQ-SEC-02        | Emitted symlinks confined to repo root (no escape)                      | §6.2    |
| REQ-SEC-03        | Never transmit repo contents externally (network = package resolve only) | §6.3    |
| OQ-1 (resolved)   | Opt-in pin-to-known-good fallback set                                    | §5.4    |
| OQ-3 (resolved)   | Never-clobber via content-hash provenance; skip-and-flag on divergence   | §3      |

## 1. Purpose & scope

In scope (this document is authoritative for all of it):

- **Provenance write** during emit (Phase 4): computing and recording the sha256
  of every managed plumbing file (§2).
- **Re-run algorithm**: implementing the decision table from
  `00-core-definitions.md §3.3` — absent → emit; hash-matches → regenerate;
  hash-differs → skip + flag; native pages always preserved (§3).
- **Idempotency rationale** (§4).
- **Version resolution & pin policy**, including the opt-in known-good fallback
  set (§5).
- **Safety policy** — write confinement, symlink confinement, no external
  transmission (§6). `04-content-symlink-layer.md` cross-references here for the
  symlink-confinement rule rather than restating it.
- **Build smoke test & outcome handling** (§7) and **partial-emission policy**
  (§8), both mapped onto the outcome taxonomy in `00-core-definitions.md §7`.

Out of scope: the *shape* of `.doc-site-scaffold.json` (defined once in
`00-core-definitions.md §3` — this document cites it, never redefines it); the
*shape* of `docs.manifest.json` (`00-core-definitions.md §2`); the content of
each emitted file (the component docs `03`–`07`); performing the deploy
(`OOS-03`); auto-upgrade beyond idempotent re-run (`OOS-04`).

## 2. Provenance write during emission (Phase 4)

The provenance manifest is `.doc-site-scaffold.json` at the **target repo root**.
Its shape, field contract, and re-run decision semantics are defined in
`00-core-definitions.md §3` and are **not** redefined here. This section
specifies only the *write procedure* the agent follows in `SKILL.md` Phase 4
(`01-architecture-layout.md §4`).

### 2.1 Per-file hash recording (REQ-RERUN-01)

For every **managed plumbing file** the agent emits (the template groups in
`01-architecture-layout.md §2.2`: `core/`, `symlink/setup-docs.sh`,
`diagrams/` prebuild + vendored renderer, each selected `deploy/` file,
`drift-guard/check-docs.mjs`, the copied `docs.manifest.schema.json`, and the
`monorepo/` fragments' resulting files), immediately after writing the resolved
bytes the agent computes the sha256 of **exactly the bytes it just wrote** and
records `"<repo-rel-path>": "sha256:<lowercase-hex>"` in `files`.

The digest is computed over the file's UTF-8 bytes (`00-core-definitions.md §3.3`).
Concrete command (the agent runs the first that is available; both yield the same
lowercase-hex digest):

```sh
# GNU coreutils:
sha256sum -- "$f" | cut -d' ' -f1
# BSD / macOS:
shasum -a 256 -- "$f" | cut -d' ' -f1
```

The recorded value is the literal string `sha256:` (a fixed prefix,
`00-core-definitions.md §3.3`) concatenated with the 64-character lowercase-hex
digest. Hashing the **emitted bytes** (not re-reading after any later editor
touch) is what makes a subsequent identical re-run a no-op (§4).

### 2.2 What is never recorded (REQ-RERUN-02)

- **Authored content pages** (`source: "native"` in `docs.manifest.json`,
  `00-core-definitions.md §2.2`) are **never** added to `files`. They are
  user-owned; absence from the provenance map is precisely what guarantees they
  are always preserved on re-run (§3, decision-table row 4).
- **Symlinks** created by `setup-docs.sh` (`04-content-symlink-layer.md`) are not
  individually hashed; `setup-docs.sh` itself is a managed file and is hashed, but
  the links it produces are reconciled by re-running `setup-docs.sh` (idempotent
  by construction, §4), not by provenance hashing.
- `docs.manifest.json` **is** managed (the generator authors it), so it is
  recorded; but its `pages[]` whose `source: "native"` describe files that are
  not themselves recorded.

### 2.3 Provenance fields written at first scaffold vs re-run

| Field (`00 §3.2`)   | First scaffold                              | Re-run                                                              |
| ------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| `version`           | scaffold-format version of the generator    | overwrite with current generator's value                           |
| `diagramContract`   | pinned `CONTRACT_VERSION` iff diagrams emitted | preserve unless diagrams (re)emitted this run                    |
| `astroPin`          | resolved latest (§5.1)                       | **preserve** existing value (§5.2)                                 |
| `starlightPin`      | resolved latest (§5.1)                       | **preserve** existing value (§5.2)                                 |
| `files`             | one entry per emitted managed file          | updated **in place**: re-hash regenerated files, keep skipped ones |

After Phase 4 the agent writes the updated `.doc-site-scaffold.json` back to the
target root (a managed write, governed by §6.1).

## 3. Re-run algorithm (REQ-RERUN-01/02, OQ-3)

This section implements the decision table in `00-core-definitions.md §3.3`. On
any invocation the agent first reads `.doc-site-scaffold.json` from the target
root. If it is **absent**, this is a first scaffold: every managed file is
"absent in tree → (re)emit" and §5.1 (resolve latest) applies. If it is
**present**, this is a re-run: per managed file the agent applies the decision
table below before writing.

### 3.1 Per-file decision (the never-clobber core)

For each managed file the current run *would* emit, with `recorded =
provenance.files[path]` (may be undefined) and `current = on-disk file` (may be
absent):

```
function decideManagedFile(path, recorded):
    if file at `path` is ABSENT on disk:
        action = EMIT                      # (re)create it
    else:
        actual = "sha256:" + sha256_hex(path)     # §2.1 command
        if recorded is undefined:
            action = SKIP_FLAG             # untracked pre-existing file — treat as user-owned
        elif actual == recorded:
            action = REGENERATE            # we own it & user hasn't touched it → overwrite
        else:
            action = SKIP_FLAG             # user-edited since last scaffold → never clobber (OQ-3)
    return action
```

Mapping to `00-core-definitions.md §3.3`:

| On-disk state                              | `recorded` | Action       | §3.3 row |
| ------------------------------------------ | ---------- | ------------ | -------- |
| Absent                                     | any        | `EMIT`       | row 1    |
| Present, `actual == recorded`              | matches    | `REGENERATE` | row 2    |
| Present, `actual != recorded` (user-edited) | differs    | `SKIP_FLAG`  | row 3    |
| Present, no record (untracked)             | undefined  | `SKIP_FLAG`  | (conservative extension of row 3) |
| `source: native` page                      | never recorded | `PRESERVE` (never considered for emit) | row 4 |

`SKIP_FLAG` ⇒ the agent does **not** write the file and emits a `RERUN_SKIP`
outcome record (`00-core-definitions.md §7`) naming the path, e.g.:

```
RERUN_SKIP  docs/astro.config.mjs — modified since last scaffold (hash mismatch); left untouched.
            To accept the regenerated version, delete the file and re-run, or reconcile manually.
```

The run continues with the remaining files (a skip is never a hard fail).
`REGENERATE` ⇒ write the resolved bytes and **re-record** the new hash in `files`
(§2.1). `EMIT` ⇒ write and record. `PRESERVE` ⇒ no action (native pages are never
in the emit set).

### 3.2 In-place reconciliation of manifest / sidebar / symlinks

After per-file decisions, three derived artifacts are reconciled **in place**
(REQ-RERUN-01) rather than clobbered:

1. **`docs.manifest.json`** — itself a managed file, so it follows §3.1. If the
   user edited it (hash mismatch), it is **skipped + flagged** and the run uses
   the *on-disk* manifest as the source of truth for the steps below (the user's
   intent wins). If unedited, the generator may regenerate it from new interview
   answers.
2. **Sidebar** — generated from the (on-disk) manifest by the core scaffold
   (`03-core-site-and-manifest.md`); regenerated deterministically, so it tracks
   the manifest with no parallel hand-kept copy.
3. **Symlinks** — reconciled by re-running `setup-docs.sh`
   (`04-content-symlink-layer.md`), which is idempotent: it creates missing links,
   leaves correct links untouched, and clears the `.astro` cache. Native pages on
   disk are never symlinked and never removed.

### 3.3 Version pins on re-run

A re-run **never** re-resolves versions. `astroPin`/`starlightPin` and the
`package.json` dependency ranges are preserved exactly (§5.2, REQ-RERUN-01). A
bump is an explicit, separate opt-in (§5.3) — never a re-run side effect.

### 3.4 Example re-run trace

Target was scaffolded, then the user edited `docs/astro.config.mjs` and added a
native page `docs/src/content/docs/team.mdx`. Re-running with the same answers:

```
read .doc-site-scaffold.json                       → present (re-run)
docs/astro.config.mjs   present, hash != recorded   → SKIP_FLAG  (RERUN_SKIP)
docs/package.json       present, hash == recorded    → REGENERATE (pins preserved, §3.3)
docs/setup-docs.sh      present, hash == recorded    → REGENERATE
docs/team.mdx (native)  not in files                 → PRESERVE
run setup-docs.sh                                    → links reconciled, .astro cleared
build smoke test (§7)                                → GREEN  → OK
```

Result: the user's config edit and native page survive; plumbing is refreshed.

## 4. Idempotency rationale (REQ-REL-01)

A second identical run yields a **no-op git diff** in the target tree, modulo
regenerated build caches (e.g. `.astro/`, `dist/`). This is a consequence of two
mechanisms, not a coincidence:

1. **Deterministic substitution** (`00-core-definitions.md §4`,
   `01-architecture-layout.md §2`). Emitted files are a pure function of the
   `.tmpl` bytes plus the interview/detection answers, via global literal
   `{{TOKEN}}` replacement with no in-template logic. Identical answers ⇒
   byte-identical resolved output.
2. **Provenance-gated writes** (§2, §3). On the second run every managed file is
   present with `actual == recorded` (because run #1 recorded the exact bytes it
   wrote, §2.1, and nothing edited them), so every file takes the `REGENERATE`
   branch and is overwritten with **the same bytes** — a no-op at the content
   level — and re-recorded with the **same** hash. Native pages are `PRESERVE`d.
   `setup-docs.sh` is idempotent (§3.2). Version pins are preserved (§3.3), so
   `package.json` is byte-stable.

Because run #1 hashed the *emitted* bytes (not a post-format re-read), and
substitution is deterministic, the run #2 hash equals the recorded hash, so no
file is spuriously flagged. The only tree changes are regenerated build caches,
which `REQ-REL-01` explicitly exempts and which the emitted `.gitignore`
(`03-core-site-and-manifest.md`) excludes from version control.

**Verification of this property** is the scaffold-output golden fixture
(`10-testing-strategy.md`): applying the same answer set twice produces
byte-identical resolved files.

## 5. Version resolution & pin policy (REQ-REL-02, REQ-RERUN-01, OQ-1)

The tokens `{{ASTRO_VERSION}}` and `{{STARLIGHT_VERSION}}`
(`00-core-definitions.md §4.1`) feed the emitted `docs/package.json`
(`03-core-site-and-manifest.md`). Their values are governed entirely by this
section.

### 5.1 First scaffold — resolve latest (REQ-REL-02)

On a **first** scaffold (no `.doc-site-scaffold.json`), the agent resolves the
**latest published** versions of Astro and Starlight and writes the resolved pins
into both `package.json` (the dependency ranges) and the provenance manifest
(`astroPin` / `starlightPin`, `00-core-definitions.md §3.1`).

Resolution queries the **package registry only** — this is the *sole* permitted
network use (§6.3); it never reads or transmits repo contents. Concrete command
(package-manager-agnostic via the npm registry, which `pnpm`/`bun` also resolve
against):

```sh
# Resolve latest published versions (registry metadata only — no repo data sent):
ASTRO_VERSION=$(npm view astro version)
STARLIGHT_VERSION=$(npm view @astrojs/starlight version)
```

`npm view <pkg> version` prints the single latest-tag version (e.g. `5.13.2`) and
exits 0; nonzero exit (offline, registry error) is handled by §5.4. The resolved
values populate the tokens; the emitted `package.json` pins them as caret ranges
matched to the resolved major/minor (e.g. `"astro": "^5.13.2"`,
`"@astrojs/starlight": "^0.36.0"`) so the smoke-test install is reproducible
within that range. The exact-resolved version (no caret) is what is stored in
`astroPin`/`starlightPin` for the re-run preserve contract (§5.2).

If a network query is impossible and the user has not opted into the fallback
set, the agent surfaces the failure as an assumption/remediation and offers the
known-good fallback (§5.4) rather than guessing a version.

### 5.2 Re-run — preserve pins (REQ-RERUN-01)

On a **re-run** the agent reads `astroPin`/`starlightPin` from the existing
`.doc-site-scaffold.json` and uses **those** values for `{{ASTRO_VERSION}}` /
`{{STARLIGHT_VERSION}}`. It does **not** call `npm view`. This guarantees the
re-emitted `package.json` is byte-stable (§4) and prevents an unwanted upstream
bump from sneaking in as a re-run side effect (REQ-RERUN-01). If the on-disk
`package.json` was user-edited, it follows the never-clobber rule (§3.1) and is
left untouched regardless.

### 5.3 Explicit bump (opt-in only)

Upgrading the pins is an explicit, separate action the user requests in the
interview ("bump Astro/Starlight to latest"). Only then does a re-run perform the
§5.1 resolution, overwrite `astroPin`/`starlightPin`, and regenerate
`package.json` (subject to never-clobber if the user edited it). A bump is never
implicit (REQ-RERUN-01).

### 5.4 Opt-in pin-to-known-good fallback set (OQ-1 resolved)

For reproducibility, or when "latest" is broken/unreachable, the user may opt
into a **documented known-good fallback set** — a pinned Astro+Starlight pair the
generator has validated against the canon build. When selected (interview flag,
or auto-offered when §5.1 resolution fails), the agent uses the fallback versions
for the tokens and records them in `astroPin`/`starlightPin`, and surfaces an
assumption record (`00-core-definitions.md §6`) noting that pinned-fallback mode
was used instead of latest. The fallback set lives in `references/rerun.md`
(`01-architecture-layout.md §1`) so it can be refreshed without touching this
spec. This resolves OQ-1 minimally: latest by default, opt-in reproducibility.

## 6. Safety policy (REQ-SEC-01/02/03) — authoritative

This section is the **authoritative safety policy** for the generator. Other docs
(notably `04-content-symlink-layer.md` for symlink confinement) cross-reference
here rather than restating these rules.

### 6.1 Write confinement (REQ-SEC-01)

The generator writes **only** within the target repo tree. The "target repo
tree" is rooted at the directory containing the repo's VCS root / the directory
the agent was invoked against (the same root used for repo-relative POSIX paths,
`00-core-definitions.md §1`). Every path the agent writes — template-resolved
files, `docs.manifest.json`, `.doc-site-scaffold.json`, the vendored
`scripts/diagram-render.mjs`, deploy configs under `.github/`, monorepo fragments
— MUST resolve to a path **at or below** that root. The agent MUST refuse (no
write) any computed target path that, after resolution, escapes the root (e.g. a
`{{DOCS_PKG_DIR}}` containing `..` that climbs above root, or an absolute path).
Such a case is a `HARD_FAIL_IMPOSSIBLE` / refusal, not a silent skip.

### 6.2 Symlink confinement (REQ-SEC-02)

Every symlink the emitted `setup-docs.sh` creates (`04-content-symlink-layer.md`)
MUST resolve to a target **inside the repo root**; no link may escape the repo
tree. Concretely:

- Links are created **relative** (`ln -s <relative-target> <link>`), computed from
  the content dir to the repo-root `from` path in `docs.manifest.json`
  (`00 §2.2`), so the tree stays portable and self-contained.
- The `images/` **directory** symlink uses `-n` / `--no-dereference`
  (`ln -sfn <target> images`) so re-linking replaces the link itself rather than
  writing through an existing link's target (`tech-spec §3.5`,
  `04-content-symlink-layer.md`).
- Before creating a link, the generator MUST verify the `from` path resolves to a
  location **at or below** the repo root and **refuse** any `from` that escapes it
  (e.g. `from: "../../secrets.md"`). An escaping `from` is rejected with a
  remediation message; it never produces a link. This is the canonical statement
  of REQ-SEC-02 that `04` defers to.

### 6.3 No external transmission (REQ-SEC-03)

The generator MUST NOT transmit repo contents to any external service. Detection
reads **only** target-repo files, never the network
(`00-core-definitions.md §6`, `tech-spec §3.12`). The **only** permitted network
access in the entire procedure is **package resolution / install** — the
`npm view` version query (§5.1) and the dependency install that the build smoke
test runs (§7) — which send package *names*, never repo file contents. No
telemetry, no uploading of the manifest, configs, or any scaffolded file. This
constraint is asserted by review of the SKILL.md procedure (no step other than
§5.1 resolution and §7 install touches the network).

## 7. Build smoke test & completion (REQ-VERIFY-01/02/03)

Phase 6 (`01-architecture-layout.md §4`). Before declaring success the generator
MUST run the emitted build end-to-end and require it to go **green**
(REQ-VERIFY-01). Success/failure map onto the outcome taxonomy in
`00-core-definitions.md §7`.

### 7.1 Steps (in order)

1. **Install dependencies** in the docs package using the detected package
   manager (`{{PKG_MANAGER}}`, `00 §4.1`):
   `npm install` / `pnpm install` / `bun install` in `{{DOCS_PKG_DIR}}`
   (or the workspace root for monorepos, REQ-PORT-03).
2. **Content setup** — only when `contentMode ∈ {symlink, mixed}`
   (`00-core-definitions.md §5`): run the emitted symlinker:
   ```sh
   sh setup-docs.sh
   ```
   This creates the manifest-driven symlinks (§6.2) and clears the `.astro`
   cache. Native mode has no symlinker and skips this step
   (`04-content-symlink-layer.md`).
3. **Diagram prebuild** — only when `diagrams = true`: the emitted `prebuild`
   hook invokes the **vendored** `diagram-render.mjs` per its frozen v1.0.0
   contract (`00-core-definitions.md §8`, `05-diagrams-component.md`), exercising
   **real** diagram generation (REQ-DIAG-03). Any nonzero renderer exit
   (`2/3/4/5/6/64`, `00 §8`) fails the build and is surfaced, not masked
   (§7.3).
4. **Site build**:
   ```sh
   npm run build        # or pnpm/bun run build — the emitted package.json script
   ```
   (Astro build; the `prebuild` from step 3 runs automatically as part of it.)

The smoke test is GREEN only if every applicable step exits 0.

### 7.2 Success → `OK`

When install + content setup + build (incl. real diagram prebuild if selected)
all go green, the outcome is `OK` (`00-core-definitions.md §7`) and the generator
proceeds to print next steps (§7.4).

### 7.3 Failure → `BUILD_RED` (REQ-VERIFY-02)

If any smoke-test step exits nonzero, the outcome is `BUILD_RED`
(`00-core-definitions.md §7`). The generator MUST:

- Report **which step** failed (install / content setup / diagram prebuild /
  build) and the captured error output / exit code.
- Provide **remediation** (e.g. "diagram renderer exited 3 (render error) on
  `architecture.json`; fix the spec and re-run", or "install failed — check
  network/registry", or "build failed: missing frontmatter on `docs/intro.md`").
- **Never report success** on a red build (REQ-VERIFY-02). The partial tree is
  recoverable by re-run (§8, §3).

A renderer nonzero exit is a `BUILD_RED` cause surfaced verbatim with its exit
code; for `--format both`, exit 5 (PNG error) may leave a written SVG — the
generator reports the failure rather than treating the partial artifact as
success (`tech-spec §3.6`, `00 §8`).

### 7.4 Next steps on success (REQ-VERIFY-03)

On `OK`, the generator prints clear next steps, tailored to the selection record
(`00-core-definitions.md §5`):

- **Run / preview locally**: `<pkg-mgr> run dev` (and `<pkg-mgr> run build`)
  in `{{DOCS_PKG_DIR}}` (or the root passthrough `dev:docs` / `build:docs` for
  monorepos, REQ-PORT-03).
- **Content note** (symlink/mixed only): "run `sh setup-docs.sh` after changing
  the manifest or pulling new docs".
- **Deploy guidance** per selected target (`06-deploy-and-monorepo.md`): GitHub Pages
  (push to `{{DEFAULT_BRANCH}}`; enable Pages), Vercel (import project), static /
  Netlify (publish `dist/`).
- **Drift guard** (if `driftGuard = true`): how `check-docs.mjs` is wired into the
  gate (`07-drift-guard.md`).
- **All assumption records** collected during detection (REQ-USE-02,
  `00-core-definitions.md §6.2`) and any `RERUN_SKIP` flags (§3.1) so the user
  knows exactly what was assumed and what was left untouched.

## 8. Partial-emission policy (REQ-VERIFY-04)

Emission is **non-transactional**. If the generator fails partway through Phase 4
(after writing some files but before the full set), it MUST NOT attempt a
rollback. Instead the outcome is `PARTIAL_EMISSION`
(`00-core-definitions.md §7`), and the generator MUST:

1. **Flag the partial state** clearly — the target tree contains a partial
   scaffold and is not yet buildable.
2. **Name the failed step** — which file/component emission failed and why.
3. **Persist provenance for what was written** — files successfully emitted
   before the failure are already recorded in `.doc-site-scaffold.json` (§2.1),
   so they are correctly classified on the next run.
4. **Advise re-run for recovery** — re-running reconciles the tree in place via
   the never-clobber, manifest-driven merge (§3): already-emitted unedited files
   `REGENERATE` (idempotent, §4), missing files `EMIT`, user-edited files
   `SKIP_FLAG`. The re-run picks up where the partial run left off without
   clobbering anything.

This is intentionally distinct from the `diagram-generator` sibling's per-artifact
*no-partial-writes* guarantee, which applies only to that tool's own
single-artifact output (`00-core-definitions.md §7`, `tech-spec §7`,
PRD REQ-VERIFY-04). The doc-site generator's multi-file emission deliberately
leaves a recoverable partial tree rather than a fragile all-or-nothing write.

## Dependencies

Must be understood/implemented first:

- **`00-core-definitions.md`** — the provenance manifest shape and re-run decision
  table (§3, §3.3), the substitution-token vocabulary incl. `{{ASTRO_VERSION}}` /
  `{{STARLIGHT_VERSION}}` (§4.1), the component-selection model (§5), the
  detection/assumption model (§6), the generator outcome taxonomy (§7), and the
  consumed renderer contract + exit codes (§8). This document **cites** these; it
  does not redefine them.
- **`01-architecture-layout.md`** — the `SKILL.md` phase map (Phases 4/6/7) this
  document drives, the template-group → managed-file mapping (§2.2) whose files
  are hashed/verified here, and the `references/rerun.md` location for the
  fallback set.

These component docs emit the managed files this document tracks (provenance) and
verifies (smoke test); their *content* is owned there, their *lifecycle* here:

- **`03-core-site-and-manifest.md`** — core scaffold, `package.json` (carrying the
  resolved pins, §5), `docs.manifest.json`, generated sidebar, `.gitignore`.
- **`04-content-symlink-layer.md`** — `setup-docs.sh`; defers to §6.2 for symlink
  confinement.
- **`05-diagrams-component.md`** — vendored renderer + prebuild hook (smoke-test
  step 3, §7.1).
- **`06-deploy-and-monorepo.md`** — deploy configs (managed files; smoke test does not
  run a deploy, `OOS-03`).
- **`07-drift-guard.md`** — `check-docs.mjs` (managed file).

## Verification

Confirm an implementation matches this spec by checking the PRD success criteria
(`PRD §8`):

- [ ] **Provenance write**: after a first scaffold, `.doc-site-scaffold.json`
      exists at target root with a `files` entry per managed plumbing file whose
      value is `sha256:<hex>` equal to `sha256sum` of the on-disk bytes; no
      `source: native` page appears in `files` (§2.1, §2.2; `00 §3`).
- [ ] **Pins recorded**: `astroPin`/`starlightPin` hold the exact versions
      resolved at first scaffold, and `package.json` pins matching ranges (§5.1).
- [ ] **Re-run never clobbers**: editing a managed file then re-running leaves
      that file untouched and emits a `RERUN_SKIP` flag naming it; an unedited
      managed file is regenerated identically; a `source: native` page is
      preserved (§3; PRD: "updates manifest/sidebar/symlinks in place with no
      destructive overwrite of edited pages").
- [ ] **Pins preserved on re-run**: a plain re-run does not call `npm view` and
      leaves `astroPin`/`starlightPin` and `package.json` ranges byte-identical;
      only an explicit bump (§5.3) changes them (§5.2; REQ-RERUN-01).
- [ ] **Idempotent no-op diff**: two identical runs against a clean tree produce a
      no-op `git diff` modulo `.astro`/`dist` caches (§4, REQ-REL-01); asserted by
      the double-apply scaffold-output golden fixture (`10-testing-strategy.md`).
- [ ] **Build green gates success**: success is declared only after install +
      content setup (symlink/mixed) + build (incl. real diagram prebuild if
      diagrams) all exit 0 (§7.1, REQ-VERIFY-01).
- [ ] **Failure is honest**: a forced build failure yields `BUILD_RED` with the
      failed step + remediation and **no** success message (§7.3, REQ-VERIFY-02).
- [ ] **Next steps printed**: on success the generator prints run/preview/deploy
      guidance plus assumption + skip flags (§7.4, REQ-VERIFY-03).
- [ ] **Partial emission**: an interrupted emit leaves a flagged partial tree
      (no rollback) naming the failed step, recoverable by re-run (§8,
      REQ-VERIFY-04).
- [ ] **Safety**: no path is written outside the repo root; no symlink (incl. an
      escaping `from`) escapes the root; the only network calls are the §5.1
      version query and the §7 install (§6; REQ-SEC-01/02/03).
