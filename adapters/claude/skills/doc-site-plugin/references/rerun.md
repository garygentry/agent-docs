# rerun.md — Provenance, Re-run, Versions, Safety & the Build Smoke Test

This is the agent procedure for the **lifecycle / safety / verification** subsystem
(`SKILL.md` Phases 4, 6, 7). It is the operational companion to spec
`08-rerun-and-verification.md` and implements the decision record in
`00-core-definitions.md §3.3`. Read it whenever you emit files, re-run against an
already-scaffolded repo, resolve versions, or gate success on the build.

The "code" here is the exact shell/CLI commands you run (`sha256sum`/`shasum`, `ln`,
`npm view`, the emitted build) and the decision algorithms you follow. There is no
in-repo runtime module — this behavior runs at scaffold time in the target repo.

---

## 1. Provenance write during emit (Phase 4)

The provenance manifest is `.doc-site-scaffold.json` at the **target repo root**. Its
shape and field contract are defined in `00-core-definitions.md §3` — this doc
specifies only the _write procedure_.

### 1.1 Per-file hash recording

For every **managed plumbing file** you emit — the `core/` group, `symlink/setup-docs.sh`,
the `diagrams/` prebuild + vendored `diagram-render.mjs`, each selected `deploy/` file,
`drift-guard/check-docs.mjs`, the copied `docs.manifest.schema.json`, `docs.manifest.json`,
and the files the `monorepo/` fragments produce — immediately after writing the resolved
bytes, compute the sha256 of **exactly the bytes you just wrote** and record

```json
"<repo-rel-path>": "sha256:<lowercase-hex>"
```

in the `files` map. Run the first command that is available; both yield the same
64-character lowercase-hex digest over the file's UTF-8 bytes:

```sh
# GNU coreutils:
sha256sum -- "$f" | cut -d' ' -f1
# BSD / macOS:
shasum -a 256 -- "$f" | cut -d' ' -f1
```

The recorded value is the literal prefix `sha256:` concatenated with that digest.
Hash the **emitted bytes** (not a re-read after some later editor/format touch) — that
is precisely what makes an identical re-run a no-op (§3).

### 1.2 What is never recorded

- **Authored content pages** (`source: "native"` in `docs.manifest.json`) are **never**
  added to `files`. They are user-owned; their absence from the provenance map is what
  guarantees they are always preserved on re-run (§2, decision row 4).
- **Symlinks** created by `setup-docs.sh` are not individually hashed — `setup-docs.sh`
  itself is a managed (hashed) file, and the links it produces are reconciled by
  re-running it (idempotent by construction), not by provenance hashing.
- `docs.manifest.json` **is** managed and recorded; but the `pages[]` with
  `source: "native"` describe files that are themselves not recorded.

### 1.3 Fields: first scaffold vs re-run

| Field             | First scaffold                                 | Re-run                                                        |
| ----------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| `version`         | scaffold-format version of the generator       | overwrite with the current generator's value                  |
| `diagramContract` | pinned `CONTRACT_VERSION` iff diagrams emitted | preserve unless diagrams (re)emitted this run                 |
| `astroPin`        | resolved latest (§4.1)                         | **preserve** existing value (§4.2)                            |
| `starlightPin`    | resolved latest (§4.1)                         | **preserve** existing value (§4.2)                            |
| `files`           | one entry per emitted managed file             | updated **in place**: re-hash regenerated files, keep skipped |

After Phase 4, write the updated `.doc-site-scaffold.json` back to the target root (a
managed write, governed by §5.1).

---

## 2. Re-run decision algorithm (`00 §3.3`)

On every invocation, first read `.doc-site-scaffold.json` from the target root.

- **Absent** → this is a **first scaffold**: every managed file is "absent in tree →
  EMIT", and §4.1 (resolve latest) applies.
- **Present** → this is a **re-run**: for each managed file the current run would emit,
  apply the per-file decision below _before_ writing.

### 2.1 Per-file decision (the never-clobber core)

With `recorded = provenance.files[path]` (may be undefined) and `current = on-disk file`
(may be absent):

```
function decideManagedFile(path, recorded):
    if file at `path` is ABSENT on disk:
        action = EMIT                      # (re)create it
    else:
        actual = "sha256:" + sha256_hex(path)     # §1.1 command
        if recorded is undefined:
            action = SKIP_FLAG             # untracked pre-existing file — treat as user-owned
        elif actual == recorded:
            action = REGENERATE            # we own it & user hasn't touched it → overwrite
        else:
            action = SKIP_FLAG             # user-edited since last scaffold → never clobber
    return action
```

Mapping to `00-core-definitions.md §3.3`:

| On-disk state                               | `recorded`     | Action                                   | §3.3 row |
| ------------------------------------------- | -------------- | ---------------------------------------- | -------- |
| Absent                                      | any            | `EMIT`                                   | row 1    |
| Present, `actual == recorded`               | matches        | `REGENERATE`                             | row 2    |
| Present, `actual != recorded` (user-edited) | differs        | `SKIP_FLAG`                              | row 3    |
| Present, no record (untracked)              | undefined      | `SKIP_FLAG` (conservative ext. of row 3) | —        |
| `source: native` page                       | never recorded | `PRESERVE` (never in the emit set)       | row 4    |

- **`EMIT`** → write the resolved bytes and record the hash (§1.1).
- **`REGENERATE`** → write the resolved bytes and **re-record** the new hash.
- **`SKIP_FLAG`** → do **not** write the file; emit a `RERUN_SKIP` outcome record
  (`00 §7`) naming the path. A skip is **never** a hard fail — continue with the
  remaining files. Example:

  ```
  RERUN_SKIP  docs/astro.config.mjs — modified since last scaffold (hash mismatch); left untouched.
              To accept the regenerated version, delete the file and re-run, or reconcile manually.
  ```

- **`PRESERVE`** → no action; native pages are never in the emit set.

### 2.2 In-place reconciliation of manifest / sidebar / symlinks

After the per-file decisions, three derived artifacts are reconciled **in place**, not
clobbered:

1. **`docs.manifest.json`** — itself managed, so it follows §2.1. If the user edited it
   (hash mismatch), it is **skipped + flagged**, and the run uses the **on-disk** manifest
   as the source of truth for the steps below (user intent wins). If unedited, you may
   regenerate it from new interview answers.
2. **Sidebar** — generated deterministically from the on-disk manifest by the core
   scaffold (`core.md`); it tracks the manifest with no parallel hand-kept copy.
3. **Symlinks** — reconciled by re-running `setup-docs.sh` (`symlink.md`), which is
   idempotent: it creates missing links, leaves correct links untouched, and clears the
   `.astro` cache. Native pages on disk are never symlinked and never removed.

Version pins are **never** re-resolved on a re-run (§4.2).

### 2.3 Example re-run trace

Target was scaffolded, then the user edited `docs/astro.config.mjs` and added a native
page `docs/src/content/docs/team.mdx`. Re-running with the same answers:

```
read .doc-site-scaffold.json                        → present (re-run)
docs/astro.config.mjs   present, hash != recorded    → SKIP_FLAG  (RERUN_SKIP)
docs/package.json       present, hash == recorded    → REGENERATE (pins preserved, §2.2)
docs/setup-docs.sh      present, hash == recorded    → REGENERATE
docs/team.mdx (native)  not in files                 → PRESERVE
run setup-docs.sh                                    → links reconciled, .astro cleared
build smoke test (§6)                                → GREEN  → OK
```

The user's config edit and native page survive; plumbing is refreshed.

---

## 3. Idempotency rationale (no-op git diff)

A second identical run yields a **no-op git diff** in the target tree, modulo
regenerated build caches (`.astro/`, `dist/`). This is a consequence of two mechanisms:

1. **Deterministic substitution** — emitted files are a pure function of the `.tmpl`
   bytes plus the interview/detection answers, via global literal `{{TOKEN}}` replacement
   with no in-template logic. Identical answers ⇒ byte-identical resolved output.
2. **Provenance-gated writes** — on the second run every managed file is present with
   `actual == recorded` (run #1 recorded the exact bytes it wrote, and nothing edited
   them), so every file takes the `REGENERATE` branch and is overwritten with **the same
   bytes** and re-recorded with the **same** hash. Native pages are `PRESERVE`d,
   `setup-docs.sh` is idempotent, and version pins are preserved — so `package.json` is
   byte-stable.

Because run #1 hashed the _emitted_ bytes and substitution is deterministic, the run #2
hash equals the recorded hash, so no file is spuriously flagged. The only tree changes
are regenerated build caches, which the emitted `.gitignore` excludes from version
control. This property is asserted by the double-apply scaffold-output golden fixture
(`10-testing-strategy.md`).

---

## 4. Version resolution & pin policy

`{{ASTRO_VERSION}}` and `{{STARLIGHT_VERSION}}` feed the emitted `docs/package.json`
(`core.md`). Their values are governed entirely by this section.

### 4.1 First scaffold — resolve latest

On a first scaffold (no `.doc-site-scaffold.json`), resolve the **latest published**
versions of Astro and Starlight, and write the resolved pins into both `package.json`
(dependency ranges) and the provenance manifest (`astroPin` / `starlightPin`).

Resolution queries the **package registry only** — the _sole_ permitted network use
besides install (§5.3); it never reads or transmits repo contents:

```sh
# Resolve latest published versions (registry metadata only — no repo data sent):
ASTRO_VERSION=$(npm view astro version)
STARLIGHT_VERSION=$(npm view @astrojs/starlight version)
```

`npm view <pkg> version` prints the single latest-tag version (e.g. `5.13.2`) and exits
0; a nonzero exit (offline, registry error) is handled by §4.4. The emitted
`package.json` pins them as **caret ranges** matched to the resolved major/minor
(e.g. `"astro": "^5.13.2"`, `"@astrojs/starlight": "^0.36.0"`) so the smoke-test install
is reproducible within that range. The exact resolved version (no caret) is stored in
`astroPin` / `starlightPin` for the re-run preserve contract (§4.2).

If a network query is impossible and the user has not opted into the fallback set,
surface the failure as an assumption/remediation and offer the known-good fallback
(§4.4) rather than guessing a version.

### 4.2 Re-run — preserve pins

On a re-run, read `astroPin` / `starlightPin` from the existing `.doc-site-scaffold.json`
and use **those** values for the tokens. Do **not** call `npm view`. This keeps the
re-emitted `package.json` byte-stable (§3) and prevents an unwanted upstream bump from
sneaking in as a re-run side effect. If the on-disk `package.json` was user-edited, it
follows the never-clobber rule (§2.1) and is left untouched regardless.

### 4.3 Explicit bump (opt-in only)

Upgrading the pins is an explicit, separate action the user requests in the interview
("bump Astro/Starlight to latest"). Only then does a re-run perform the §4.1 resolution,
overwrite `astroPin` / `starlightPin`, and regenerate `package.json` (subject to
never-clobber if the user edited it). A bump is **never** implicit.

### 4.4 Opt-in known-good fallback set

For reproducibility, or when "latest" is broken/unreachable, the user may opt into a
**documented known-good fallback set** — a pinned Astro + Starlight pair validated
against the canon build. When selected (interview flag, or auto-offered when §4.1
resolution fails), use the fallback versions for the tokens, record them in
`astroPin` / `starlightPin`, and surface an assumption record (`00 §6`) noting that
pinned-fallback mode was used instead of latest.

**Known-good fallback pair (canon-validated):**

| Package              | Fallback version | Caret range in `package.json` |
| -------------------- | ---------------- | ----------------------------- |
| `astro`              | `5.13.2`         | `^5.13.2`                     |
| `@astrojs/starlight` | `0.36.0`         | `^0.36.0`                     |

This pair lives here (not in the spec) so it can be refreshed without touching the
decision record.

---

## 5. Safety policy (authoritative)

This is the **authoritative safety policy** for the generator. Other docs (notably
`symlink.md` for symlink confinement) defer here.

### 5.1 Write confinement

The generator writes **only** within the target repo tree, rooted at the repo's VCS root
/ the directory the agent was invoked against (the same root used for repo-relative POSIX
paths). Every path you write — template-resolved files, `docs.manifest.json`,
`.doc-site-scaffold.json`, the vendored `scripts/diagram-render.mjs`, deploy configs under
`.github/`, monorepo fragments — MUST resolve to a path **at or below** that root. Refuse
(no write) any computed target path that, after resolution, escapes the root (e.g. a
`{{DOCS_PKG_DIR}}` containing `..` that climbs above root, or an absolute path). Such a
case is a `HARD_FAIL_IMPOSSIBLE` / refusal, not a silent skip.

### 5.2 Symlink confinement

Every symlink the emitted `setup-docs.sh` creates MUST resolve to a target **inside the
repo root**; no link may escape the tree.

- Links are created **relative** (`ln -s <relative-target> <link>`), computed from the
  content dir to the repo-root `from` path in `docs.manifest.json`, so the tree stays
  portable and self-contained.
- The `images/` **directory** symlink uses `-n` / `--no-dereference`
  (`ln -sfn <target> images`) so re-linking replaces the link itself rather than writing
  through an existing link's target.
- Before creating a link, verify the `from` path resolves to a location **at or below**
  the repo root and **refuse** any `from` that escapes it (e.g. `from: "../../secrets.md"`).
  An escaping `from` is rejected with a remediation message; it never produces a link.

### 5.3 No external transmission

The generator MUST NOT transmit repo contents to any external service. Detection reads
**only** target-repo files, never the network. The **only** permitted network access in
the entire procedure is **package resolution / install** — the `npm view` version query
(§4.1) and the dependency install the build smoke test runs (§6) — which send package
_names_, never repo file contents. No telemetry, no uploading of the manifest, configs,
or any scaffolded file.

---

## 6. Build smoke test gate (Phase 6)

Before declaring success, you MUST run the emitted build end-to-end and require it to go
**green**. Success/failure map onto the outcome taxonomy in `00-core-definitions.md §7`.

### 6.1 Steps (in order)

1. **Install dependencies** in the docs package using the detected package manager
   (`{{PKG_MANAGER}}`): `npm install` / `pnpm install` / `bun install` in
   `{{DOCS_PKG_DIR}}` (or the workspace root for monorepos).
2. **Content setup** — only when `contentMode ∈ {symlink, mixed}`: run the emitted
   symlinker:
   ```sh
   sh setup-docs.sh
   ```
   This creates the manifest-driven symlinks (§5.2) and clears the `.astro` cache. Native
   mode has no symlinker and skips this step.
3. **Diagram prebuild** — only when `diagrams = true`: the emitted `prebuild` hook invokes
   the **vendored** `diagram-render.mjs` per its frozen v1.0.0 contract (`diagrams.md`),
   exercising **real** diagram generation. Any nonzero renderer exit (`2/3/4/5/6/64`,
   `00 §8`) fails the build and is surfaced, not masked (§6.3).
4. **Site build**:
   ```sh
   npm run build        # or pnpm/bun run build — the emitted package.json script
   ```
   (Astro build; the `prebuild` from step 3 runs automatically as part of it.)

The smoke test is GREEN only if every applicable step exits 0.

### 6.2 Success → `OK`

When install + content setup + build (incl. real diagram prebuild if selected) all go
green, the outcome is `OK` and you proceed to print next steps (Phase 7, §6.4).

### 6.3 Failure → `BUILD_RED`

If any smoke-test step exits nonzero, the outcome is `BUILD_RED`. You MUST:

- Report **which step** failed (install / content setup / diagram prebuild / build) and
  the captured error output / exit code.
- Provide **remediation** (e.g. "diagram renderer exited 3 (render error) on
  `architecture.json`; fix the spec and re-run", "install failed — check
  network/registry", "build failed: missing frontmatter on `docs/intro.md`").
- **Never report success** on a red build. The partial tree is recoverable by re-run
  (§7, §2).

A renderer nonzero exit is a `BUILD_RED` cause surfaced verbatim with its exit code; for
`--format both`, exit 5 (PNG error) may leave a written SVG — report the failure rather
than treating the partial artifact as success.

### 6.4 Next steps on success (Phase 7)

On `OK`, print clear next steps tailored to the selection record:

- **Run / preview locally**: `<pkg-mgr> run dev` (and `<pkg-mgr> run build`) in
  `{{DOCS_PKG_DIR}}` (or the root passthrough `dev:docs` / `build:docs` for monorepos).
- **Content note** (symlink/mixed only): "run `sh setup-docs.sh` after changing the
  manifest or pulling new docs".
- **Deploy guidance** per selected target (`deploy-github-pages.md`, `deploy-vercel.md`,
  `deploy-static-netlify.md`): GitHub Pages (push to `{{DEFAULT_BRANCH}}`; enable Pages),
  Vercel (import project), static / Netlify (publish `dist/`).
- **Drift guard** (if `driftGuard = true`): how `check-docs.mjs` is wired into the gate
  (`drift-guard.md`).
- **All assumption records** collected during detection and any `RERUN_SKIP` flags (§2.1)
  so the user knows exactly what was assumed and what was left untouched.

---

## 7. Partial-emission policy

Emission is **non-transactional**. If the generator fails partway through Phase 4 (after
writing some files but before the full set), it MUST NOT attempt a rollback. The outcome
is `PARTIAL_EMISSION`, and you MUST:

1. **Flag the partial state** clearly — the target tree contains a partial scaffold and
   is not yet buildable.
2. **Name the failed step** — which file/component emission failed and why.
3. **Persist provenance for what was written** — files emitted before the failure are
   already recorded in `.doc-site-scaffold.json` (§1.1), so they are correctly classified
   on the next run.
4. **Advise re-run for recovery** — re-running reconciles the tree in place via the
   never-clobber, manifest-driven merge (§2): already-emitted unedited files `REGENERATE`
   (idempotent, §3), missing files `EMIT`, user-edited files `SKIP_FLAG`. The re-run picks
   up where the partial run left off without clobbering anything.

This is intentionally distinct from the `diagram-generator` sibling's per-artifact
_no-partial-writes_ guarantee (which applies only to that tool's single-artifact output).
The doc-site generator's multi-file emission deliberately leaves a recoverable partial
tree rather than a fragile all-or-nothing write.
