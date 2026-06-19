# Diagrams Component (agent reference)

This reference covers the **diagrams** template group — emitted only when the
component-selection record has `diagrams: true` (`00 §5`). It
documents how the agent vendors the renderer, runs the version pin-check, fills the
generated tokens in
`references/templates/diagrams/diagrams.prebuild.snippet.tmpl`, and wires the
prebuild into the core `package.json`.

The generator does **not** ship a bespoke renderer. It **vendors** the frozen
`diagram-render.mjs` bundle from the sibling `diagram-generator` skill and invokes it
per that skill's frozen **v1.0.0 scriptable contract** (REQ-DIAG-02, CON-05). The
authoritative renderer contract (flags, exit codes, `CONTRACT_VERSION`) is owned by
the sibling `diagram-generator` skill; this file is the emit-time procedure.

---

## 1. Gating: emit only when `diagrams: true`

The `diagrams/` group is emitted **iff** the selection record has `diagrams: true`.
Nothing outside this group references it, so declining it yields **zero** diagram
files (the decline-clean guarantee, §6). When emitted, the agent performs the steps
below in order during **Phase 4 (emit)**: vendor (§2) only after the pin-check (§3)
passes, then wire the prebuild (§4) and emit a starter spec (§5).

---

## 2. Vendoring — copy the renderer at the FIXED sibling rel-path

At scaffold time the generator **copies** the renderer bundle from its sibling skill
in the same adapter bundle. It does not reimplement, inline, or fetch it.

The source is always read at the **single uniform relative path**, from the doc-site
skill's own bundle directory — identical across all five targets, with **no
per-agent branching**:

```
../diagram-generator/scripts/diagram-render.mjs
```

This works because `skillRefDir()` roots every skill under the same per-target parent
(`skills/<name>` for claude/codex/gemini, `rules/<name>` for cursor,
`instructions/<name>` for copilot). Because both `doc-site` and
`diagram-generator` live under that same parent in **every** bundle, the hop from the
doc-site skill dir to the renderer never varies by target:

| Target  | doc-site skill dir       | renderer resolved from the fixed rel-path                   |
| ------- | ------------------------ | ----------------------------------------------------------- |
| claude  | `skills/doc-site/`       | `skills/diagram-generator/scripts/diagram-render.mjs`       |
| codex   | `skills/doc-site/`       | `skills/diagram-generator/scripts/diagram-render.mjs`       |
| gemini  | `skills/doc-site/`       | `skills/diagram-generator/scripts/diagram-render.mjs`       |
| cursor  | `rules/doc-site/`        | `rules/diagram-generator/scripts/diagram-render.mjs`        |
| copilot | `instructions/doc-site/` | `instructions/diagram-generator/scripts/diagram-render.mjs` |

### Target path

The bundle is copied **byte-for-byte** (no token substitution — the `.mjs` contains
no token placeholders) into the target repo at a predictable, generator-owned path:

```
scripts/diagram-render.mjs                    # single-package target
{{DOCS_PKG_DIR}}/scripts/diagram-render.mjs   # if scoped under the docs package
```

The source file mode is preserved (`0644`). The renderer is always invoked via the
`{{RUNTIME}}` interpreter (`node`/`bun`), so it runs with zero install regardless of
the executable bit. The vendored copy is a **managed plumbing file**: its
repo-relative path and sha256 are recorded in `.doc-site-scaffold.json` `files`
(§3.2), making it subject to never-clobber on re-run
(see `rerun.md`).

---

## 3. Version pin-check — runs BEFORE vendoring (CON-05)

Before copying anything, the generator verifies the sibling renderer matches the
pinned `CONTRACT_VERSION` **`1.0.0`** (`00 §8`). It runs the
renderer's machine-readable `--version` handle at the fixed rel-path:

```sh
{{RUNTIME}} ../diagram-generator/scripts/diagram-render.mjs --version
# stdout: 1.0.0   (CONTRACT_VERSION), exit 0
```

### 3.1 Pin-check outcomes

| Observed `--version`                     | Action                                                                                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1.0.0`, exit 0                          | **Match.** Proceed to vendor (§2) and record `diagramContract: "1.0.0"` in provenance (§3.2).                                                                                                                        |
| Any other version, exit 0 (e.g. `1.1.0`) | **Mismatch.** Do **not** vendor or wire. Abort the diagram component (`HARD_FAIL_IMPOSSIBLE`-style report, `00 §7`) naming expected `1.0.0` vs. observed. Advise re-syncing `diagram-generator` to the pinned major. |
| Nonzero exit / no output / file absent   | **Unavailable.** Report the renderer could not be queried; do not vendor.                                                                                                                                            |

On **any** non-match the component aborts **before its first write**: **zero** diagram
files are emitted, and there is **NO embedded fallback** renderer (CON-05) — the
missing/mismatched prerequisite is surfaced, never substituted. `diagramContract` is
**not** written to provenance on abort (it is present only when diagrams are emitted —
`00 §3.2`).

### 3.2 Recording the pin in provenance

When the component succeeds, `.doc-site-scaffold.json` records both the contract
version and the sha256 of the vendored copy:

```jsonc
{
  "diagramContract": "1.0.0", // pinned CONTRACT_VERSION verified at scaffold (00 §3.1)
  "files": {
    "scripts/diagram-render.mjs": "sha256:…", // the vendored copy (managed plumbing)
  },
}
```

On **re-run**, the generator re-runs `--version` against the (possibly updated)
sibling and compares to the recorded `diagramContract`; a changed contract version is
surfaced. A user-edited vendored copy (hash mismatch vs. `files`) is skip-and-flagged
per the never-clobber policy (`00 §3.3`), never silently overwritten.

---

## 4. Prebuild wiring — `diagrams.prebuild.snippet.tmpl`

`references/templates/diagrams/diagrams.prebuild.snippet.tmpl` is a **`package.json`
script fragment** (not a standalone file) that the agent merges into the target docs
package's `scripts` block. It invokes the **vendored** renderer with predictable,
slug-independent output paths via `--out-file`.

### 4.1 Diagram spec inputs & output convention

User-authored `DiagramSpec` JSON inputs live under a conventional source directory in
the docs package:

```
src/diagrams/        # committed DiagramSpec JSON inputs (user-authored)
  arch.json
```

Each spec is rendered to a predictable, slug-independent path so the core site can
reference it by a stable path:

```
public/diagrams/<basename>.<theme>.svg
```

`<basename>` is the **spec file's basename** (caller-controlled via `--out-file`),
**not** the renderer's title-derived slug — so the path is stable regardless of the
spec's `title` field.

### 4.2 The invocation shape (frozen v1.0.0 contract)

Each spec is rendered **twice** — once `--theme light` with `{{ACCENT_LIGHT}}`, once
`--theme dark` with `{{ACCENT_DARK}}`. There is **no `--theme both`**
(`00 §8`). The snippet uses `--out-file` (the fully caller-controlled explicit form);
it **never** uses `--out-dir` alone (which falls back to the non-load-bearing
`<slug>.<theme>` derived name).

The resolved single-spec `scripts` fragment:

```jsonc
{
  "diagrams": "node scripts/diagram-render.mjs src/diagrams/arch.json --theme light --accent '<ACCENT_LIGHT>' --format svg --out-file public/diagrams/arch.light.svg && node scripts/diagram-render.mjs src/diagrams/arch.json --theme dark --accent '<ACCENT_DARK>' --format svg --out-file public/diagrams/arch.dark.svg",
  "prebuild": "npm run diagrams",
}
```

- The `&&` chaining is **load-bearing** for §6: a nonzero exit from **any** invocation
  short-circuits the chain and fails `prebuild`, surfacing the failure (REQ-VERIFY-02).
- `node` ↔ `bun` is selected by `{{RUNTIME}}` and `npm run` ↔ the detected package
  manager by `{{PKG_MANAGER}}` (`00 §4.1`), matching detection.
- For more than one spec, the agent enumerates `src/diagrams/*.json` and appends one
  light invocation and one dark invocation per spec, all chained with `&&`.

### 4.3 Composition with the symlink layer

When the **symlink** content layer is also selected
(`symlink.md`), its `prebuild` and this one are **both** merged into
the single `prebuild` script. The ordering is **symlink-setup first, then diagram
generation**:

```jsonc
{
  "prebuild": "sh ./setup-docs.sh && npm run diagrams",
}
```

The agent **merges** into a pre-existing `prebuild`; it never overwrites it. Astro
serves whatever sits in `public/`, so no `astro.config.mjs` change is needed for the
generated `public/diagrams/*.svg` to ship as static assets.

---

## 5. Starter spec — render for real (REQ-DIAG-03)

If the target repo has **no committed diagram spec** under `src/diagrams/`, the
generator emits a single minimal valid starter `DiagramSpec` (e.g.
`src/diagrams/arch.json`) so the build smoke test renders **for real** rather than
wiring an empty pipeline. The starter spec is a **managed plumbing file** (tracked in
provenance, never-clobber on re-run). If a spec already exists, none is added.

---

## 6. Failure handling — surface, never mask (REQ-VERIFY-02)

Any **nonzero** exit from the vendored renderer is a **build failure** the prebuild
surfaces; it is never swallowed. The exit-code contract is consumed directly from
the renderer (`00 §8`):

| Exit | Renderer meaning | Prebuild behavior                                                             |
| ---- | ---------------- | ----------------------------------------------------------------------------- |
| 0    | OK               | Continue the chain.                                                           |
| 2    | input/spec error | Fail prebuild; surface stderr (bad `DiagramSpec`).                            |
| 3    | render error     | Fail prebuild; surface stderr (engine/layout).                                |
| 4    | output error     | Fail prebuild; surface stderr (post-render assertion).                        |
| 5    | PNG error        | Fail prebuild; **see §6.1** (a `--format both` run may leave a written SVG).  |
| 6    | IO error         | Fail prebuild; surface stderr (FS write / path escape).                       |
| 64   | usage error      | Fail prebuild; indicates a malformed emitted invocation — a generator defect. |

Because the script chains invocations with `&&` (§4.2) and `prebuild` runs before
`astro build`, the **first** nonzero exit aborts the build with a nonzero status. The
build smoke test (Phase 6) observes that status and reports **`BUILD_RED`** (`00 §7`)
with the renderer's stderr — it MUST NOT report success (REQ-VERIFY-02).

### 6.1 `--format both` partial-artifact note (exit 5)

The renderer writes SVG before PNG and is atomic **per single artifact**. A
`--format both` invocation that succeeds on the SVG and then fails PNG rasterization
(exit 5) leaves the already-written SVG on disk. The prebuild **surfaces the exit-5
failure** (fails the build) rather than masking it because an SVG exists. The orphaned
SVG is harmless and is overwritten on the next successful run.

---

## 7. Decline-clean — zero files when declined (REQ-USE-01)

When the user declines diagrams (`diagrams: false`), the generator emits **zero**
diagram files and **zero** hooks:

- No vendored `scripts/diagram-render.mjs` copy.
- No `diagrams` / `prebuild` diagram script entry in `package.json` (if `prebuild`
  exists for the symlink layer only, it contains no diagram invocation).
- No `src/diagrams/` directory or starter spec.
- No `diagramContract` field in `.doc-site-scaffold.json`.
- No reference to the renderer anywhere in the emitted tree.

This is the decline-all invariant (`00 §5`): nothing outside the `diagrams/` group
references it, so omitting the group leaves no dangling hook, config, or reference.
