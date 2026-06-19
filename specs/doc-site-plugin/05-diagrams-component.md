# 05 — Diagrams Component (delegation by vendoring)

The optional **diagram component** of `doc-site-plugin`: an Astro-Starlight-ready
SVG/PNG diagram generation step wired into the target repo's `prebuild`. The
generator does **not** ship a bespoke diagram renderer — it **vendors** the frozen
`diagram-render.mjs` bundle from the sibling `diagram-generator` skill and invokes
it per that skill's **frozen v1.0.0 scriptable contract** (REQ-DIAG-02, CON-05).
This makes the doc-site build smoke test (REQ-VERIFY-01) exercise **real**
end-to-end diagram generation (REQ-DIAG-03), not merely assert that hooks exist.

This document covers the `diagrams/` template group from
`01-architecture-layout.md §2.2`: the vendoring copy + version-pin check at scaffold
time, the `prebuild` wiring (`references/templates/diagrams/diagrams.prebuild.snippet.tmpl`),
the light/dark double-invocation, the failure-surfacing rule, and the decline-clean
guarantee. It **consumes**, never redefines, the renderer contract fixed in
`00-core-definitions.md §8` and authored in `specs/diagram-generator/05-cli-and-invocation.md`.

## Requirement Coverage

| REQ / decision ID | Requirement / decision                                                        | Section |
| ----------------- | ----------------------------------------------------------------------------- | ------- |
| REQ-DIAG-01       | Offer the diagram component; decline ⇒ omit cleanly (zero dangling files)      | §2, §8  |
| REQ-DIAG-02       | Delegate generation to the sibling `diagram-generator` skill (vendor, not embed) | §3, §4  |
| REQ-DIAG-03       | Prebuild conforms to the released v1.0.0 contract; smoke test runs it for real | §5, §6, §7 |
| REQ-VERIFY-01     | Build smoke test runs the **real** prebuild and must produce artifacts (diagram half) | §7 |
| REQ-VERIFY-02     | Any nonzero renderer exit is surfaced as a build failure, never masked          | §6      |
| REQ-USE-01        | Decline-all invariant: diagrams declined ⇒ zero files/hooks emitted             | §8      |
| REQ-REL-02 / OQ-1 | `diagramContract` pin recorded in provenance; pin-check before vendoring        | §4      |

## 1. Purpose & scope

When the user selects diagrams in the interview (`02-detection-and-interview.md`;
selection record `diagrams: true`, `00-core-definitions.md §5`), the generator emits
exactly two things into the target repo:

1. **The vendored renderer** — a verbatim copy of `diagram-render.mjs` at a
   predictable target path (default `scripts/diagram-render.mjs`, §3).
2. **The prebuild wiring** — a `package.json` script fragment from
   `diagrams.prebuild.snippet.tmpl` that invokes the vendored renderer during
   `prebuild`, materializing each committed diagram spec into SVG (and optionally PNG)
   under the site's public/static tree (§5).

Diagram **content** is out of scope (OOS-02): the generator wires the pipeline; the
user authors the `DiagramSpec` JSON inputs. The Astro side that *displays* the
generated SVGs (the `passthroughImageService()` per REQ-CORE-03) is the **core**
scaffold's responsibility (`03-core-site-and-manifest.md`); this component only
produces the artifacts that the core site references.

**Hard ordering constraint (CON-05):** the diagram component builds against the
**released** `diagram-generator` skill. `diagram-generator` is implemented and frozen
(v1.0.0) **before** this component. There is no fallback renderer; if the sibling
bundle is absent or version-mismatched at scaffold time, the component fails the
pin-check (§4) rather than embedding a substitute.

## 2. Component gating (REQ-DIAG-01, REQ-USE-01)

The `diagrams/` template group is emitted **iff** the selection record has
`diagrams: true` (`00-core-definitions.md §5`; `01-architecture-layout.md §2.2`).
Nothing outside this group references it, so declining it yields zero diagram files
(the decline-clean guarantee, §8). When emitted, the agent performs the §3 vendoring,
the §4 pin-check, and the §5 prebuild wiring, in that order, during **Phase 4 (emit)**
of the SKILL.md procedure (`01-architecture-layout.md §4`).

## 3. Vendoring — copy from the sibling skill at the FIXED relative path (REQ-DIAG-02)

At scaffold time the generator **copies** the renderer bundle from its sibling skill
in the **same adapter bundle** into the target repo. It does not reimplement, inline,
or fetch it.

### 3.1 The fixed sibling source path (uniform across all five targets)

The source is always read at the **single uniform relative path**, from the doc-site
skill's own bundle directory:

```
../diagram-generator/scripts/diagram-render.mjs
```

**Why this path is uniform (no per-agent branching).** `skillRefDir()`
(`src/targets/_shared.ts:203`) roots *every* skill under the same per-target parent —
`skills/<name>` (claude/codex/gemini), `rules/<name>` (cursor),
`instructions/<name>` (copilot). Because both `doc-site-plugin` and
`diagram-generator` live under that same parent in **every** bundle, the hop from the
doc-site skill dir to the renderer never varies by target (see
`01-architecture-layout.md §5.2` for the per-target table, and tech-spec §3.6 / §6
for the cross-agent path note). The agent therefore reads exactly one path with no
target-conditional logic.

| Target  | doc-site skill dir              | renderer resolved from the fixed rel-path                       |
| ------- | ------------------------------- | --------------------------------------------------------------- |
| claude  | `skills/doc-site-plugin/`       | `skills/diagram-generator/scripts/diagram-render.mjs`           |
| codex   | `skills/doc-site-plugin/`       | `skills/diagram-generator/scripts/diagram-render.mjs`           |
| gemini  | `skills/doc-site-plugin/`       | `skills/diagram-generator/scripts/diagram-render.mjs`           |
| cursor  | `rules/doc-site-plugin/`        | `rules/diagram-generator/scripts/diagram-render.mjs`            |
| copilot | `instructions/doc-site-plugin/` | `instructions/diagram-generator/scripts/diagram-render.mjs`     |

The bundle is emitted into the diagram-generator skill **verbatim with executable
mode preserved** (`src/publish.ts:116-119`, documented in
`specs/diagram-generator/06-integration-and-packaging.md §5.1`), so the copy the
doc-site generator reads is byte-identical and runnable with zero install.

> WARNING: The renderer's location in the doc-site bundle depends on the
> diagram-generator skill being present in the same adapter bundle. Verify the file
> resolves at the fixed rel-path before vendoring (it is byte-checked into every
> `adapters/<target>/` tree by `build:check`, per `01 §5.2` and
> `specs/diagram-generator/06-integration-and-packaging.md §4.3`). If it is absent,
> the component MUST hard-fail the pin-check (§4) — never substitute a bespoke
> renderer (CON-05).

### 3.2 The vendored target path

The bundle lands in the target repo at a predictable, generator-owned path. Default:

```
scripts/diagram-render.mjs            # single-package target
{{DOCS_PKG_DIR}}/scripts/diagram-render.mjs   # if scoped under the docs package
```

`{{DOCS_PKG_DIR}}` is the canonical token (`00-core-definitions.md §4.1`); no **new**
token is introduced by this component. The vendored copy is a **managed plumbing
file**: its repo-relative path and sha256 are recorded in `.doc-site-scaffold.json`
`files` (`00-core-definitions.md §3`), making it subject to never-clobber on re-run
(`08-rerun-and-verification.md`). The copy is byte-for-byte (no token substitution —
the `.mjs` contains no `{{TOKEN}}`).

## 4. Version pinning — pin-check before vendoring (REQ-REL-02, REQ-DIAG-03, OQ-1)

Before copying, the generator verifies the sibling renderer matches the pinned
`CONTRACT_VERSION` `1.0.0` (`00-core-definitions.md §8`). It runs the renderer's
machine-readable version handle (the frozen `--version` contract,
`specs/diagram-generator/05-cli-and-invocation.md §2.4`):

```sh
node ../diagram-generator/scripts/diagram-render.mjs --version
# stdout: 1.0.0   (CONTRACT_VERSION), exit 0
```

(With `{{RUNTIME}}` = `bun`, the agent MAY invoke `bun .../diagram-render.mjs
--version`; the bundle is `--target=node` and runs under both — see
`specs/diagram-generator/05-cli-and-invocation.md §3.5`.)

### 4.1 Pin-check outcomes

| Observed `--version` output            | Action |
| -------------------------------------- | ------ |
| `1.0.0`, exit 0                        | **Match.** Proceed to vendor (§3) and record `diagramContract: "1.0.0"` in `.doc-site-scaffold.json` (`00 §3.1`). |
| Any other version, exit 0 (e.g. `1.1.0`, `2.0.0`) | **Mismatch.** Do **not** vendor or wire. Stop the diagram component with a `HARD_FAIL_IMPOSSIBLE`-style report (`00 §7`) naming the expected (`1.0.0`) vs. observed version. Advise the user to re-sync the `diagram-generator` skill to the pinned major. (A MINOR bump is additive per the contract's SemVer policy — `specs/diagram-generator/05-cli-and-invocation.md §1 "Stability & versioning"` — but this component pins the exact released `1.0.0`; a future bump of the pin is an explicit, opt-in change, never a silent acceptance.) |
| Nonzero exit / no output / file absent | **Unavailable.** Report the renderer could not be queried; do not vendor. Per CON-05 there is no embedded fallback — surface the missing prerequisite. |

On any non-match, **zero** diagram files are emitted (the component aborts before its
first write), and `diagramContract` is **not** written to provenance (it is required
in `.doc-site-scaffold.json` only when diagrams are emitted — `00 §3.2`).

### 4.2 Recording the pin

When the component succeeds, the provenance manifest records:

```jsonc
{
  "diagramContract": "1.0.0",   // pinned CONTRACT_VERSION verified at scaffold (00 §3.1)
  "files": {
    "scripts/diagram-render.mjs": "sha256:…"   // the vendored copy (managed plumbing)
  }
}
```

On **re-run** (`08-rerun-and-verification.md`), the generator re-runs `--version`
against the (possibly updated) sibling and compares to the recorded `diagramContract`.
A changed contract version is surfaced (it implies the vendored copy would change); a
user-edited vendored copy (hash mismatch vs. `files`) is skip-and-flagged per the
never-clobber policy (`00 §3.3`), never silently overwritten.

## 5. Prebuild wiring — `diagrams.prebuild.snippet.tmpl` (REQ-DIAG-03)

`references/templates/diagrams/diagrams.prebuild.snippet.tmpl` is a **package.json script
fragment** (not a standalone file) that the agent merges into the target docs
package's `scripts` block. It invokes the **vendored** renderer with **predictable,
slug-independent** output paths, using `--out-file` (or `--out-dir` + `--out-name`) —
the `<slug>.<theme>` derived convenience name is **explicitly not relied upon**
(`00 §8`; `specs/diagram-generator/05-cli-and-invocation.md §2.3`, the "slug is a
non-load-bearing nicety" note).

### 5.1 Diagram spec inputs & enumeration convention

The component establishes a conventional **diagram source directory** in the docs
package:

```
{{DOCS_PKG_DIR}}/src/diagrams/        # committed DiagramSpec JSON inputs (user-authored)
  arch.json
  data-flow.json
```

The `prebuild` enumerates `*.json` in that directory and renders each. Output
artifacts land under the site's static/public tree at a predictable, slug-independent
location so the core site (`03-core-site-and-manifest.md`) can reference them by a
stable path:

```
{{DOCS_PKG_DIR}}/public/diagrams/<basename>.<theme>.svg   (and .png when --format both)
```

The `<basename>` is the **spec file's basename** (caller-controlled via
`--out-file`/`--out-name`), **not** the renderer's title-derived slug — guaranteeing
the path is stable regardless of the spec's `title` field.

### 5.2 The invocation shape (frozen v1.0.0 contract)

Each spec is rendered twice — once per theme (there is **no** `--theme both`;
`00 §8`, `specs/diagram-generator/05-cli-and-invocation.md §3.2`). The canonical
single-spec invocation, using the explicit, fully caller-controlled `--out-file`
form:

```sh
# light variant
node scripts/diagram-render.mjs src/diagrams/arch.json \
  --type architecture --theme light --accent '{{ACCENT_LIGHT}}' \
  --format svg --out-file public/diagrams/arch.light.svg

# dark variant — invoke again (no --theme both)
node scripts/diagram-render.mjs src/diagrams/arch.json \
  --type architecture --theme dark --accent '{{ACCENT_DARK}}' \
  --format svg --out-file public/diagrams/arch.dark.svg
```

Flags are exactly those frozen in `00-core-definitions.md §8` /
`specs/diagram-generator/05-cli-and-invocation.md §2.1`:

| Flag                  | Value used by the prebuild | Rationale |
| --------------------- | -------------------------- | --------- |
| positional `<spec.json>` | the enumerated source file (`src/diagrams/<name>.json`) | dimension 1: file-path input (`00 §8`). |
| `--type`              | from the spec, or overridden per row | dimension 3; may be omitted to use the spec's `diagramType`. |
| `--theme`             | `light` then `dark` (two invocations) | no `--theme both` exists (`00 §8`). |
| `--accent`            | `{{ACCENT_LIGHT}}` / `{{ACCENT_DARK}}` | reuse the core scaffold accents (`00 §4.1`) so site + diagrams match. |
| `--format`            | `svg` (default) or `both`   | SVG always; PNG only on `png`/`both` (`00 §8`). |
| `--out-file`          | `public/diagrams/<basename>.<theme>.svg` | **predictable, slug-independent** path (dimension 2). |

> `--out-dir` + `--out-name` is the equivalent alternative form
> (`--out-dir public/diagrams --out-name arch.light`); the snippet MUST pick one
> predictable form and MUST NOT use `--out-dir` **alone** (which falls back to the
> non-load-bearing `<slug>.<theme>` derived name — `00 §8`).

### 5.3 The script fragment

`diagrams.prebuild.snippet.tmpl` resolves (after token substitution) to a
`prebuild`-phase script entry that Astro runs before `astro build` (and that may
also be wired to `predev` if live diagram regeneration is desired). A representative
resolved single-spec form:

```jsonc
// merged into {{DOCS_PKG_DIR}}/package.json "scripts"
{
  "diagrams": "node scripts/diagram-render.mjs src/diagrams/arch.json --theme light --accent '{{ACCENT_LIGHT}}' --out-file public/diagrams/arch.light.svg && node scripts/diagram-render.mjs src/diagrams/arch.json --theme dark --accent '{{ACCENT_DARK}}' --out-file public/diagrams/arch.dark.svg",
  "prebuild": "npm run diagrams"
}
```

- The `&&` chaining is load-bearing for §6: a nonzero exit from **any** invocation
  short-circuits the chain and fails `prebuild`, surfacing the failure (REQ-VERIFY-02).
- `node` ↔ `bun` and `npm run` ↔ the detected package manager are selected by
  `{{RUNTIME}}` / `{{PKG_MANAGER}}` (`00 §4.1`), matching detection (REQ-PORT-01).
- When the symlink content layer is also selected, its `prebuild` wiring
  (`04-content-symlink-layer.md`) and this one are **both** merged into the single
  `prebuild` script (e.g. `setup-docs.sh && npm run diagrams`); ordering is
  symlink-setup before diagram generation. The agent merges, it does not overwrite a
  pre-existing `prebuild`.

> Because Astro builds whatever sits in `public/`, no Astro config change is needed
> for the artifacts to ship — the generated `public/diagrams/*.svg` are served as
> static assets. The `passthroughImageService()` wiring that avoids a heavyweight
> image dependency for these SVGs (REQ-CORE-03) is the core scaffold's job
> (`03-core-site-and-manifest.md`), not this component's.

## 6. Failure handling — surface, never mask (REQ-VERIFY-02)

Any **nonzero** exit from the vendored renderer is a **build failure** that the
prebuild surfaces; it is never swallowed. The exit-code contract is consumed directly
from `00-core-definitions.md §8`:

| Exit | Renderer meaning            | Prebuild behavior |
| ---- | --------------------------- | ----------------- |
| 0    | OK                          | Continue the chain. |
| 2    | input/spec error            | Fail prebuild; surface stderr (bad `DiagramSpec`). |
| 3    | render error                | Fail prebuild; surface stderr (engine/layout). |
| 4    | output error                | Fail prebuild; surface stderr (post-render assertion). |
| 5    | PNG error                   | Fail prebuild; **see §6.1** (may leave a written SVG). |
| 6    | IO error                    | Fail prebuild; surface stderr (FS write / path escape). |
| 64   | usage error                 | Fail prebuild; indicates a malformed invocation in the emitted snippet — a generator defect, fix the wiring. |

Because the script chains invocations with `&&` (§5.3) and the docs package's
`prebuild` runs before `astro build`, the **first** nonzero exit aborts the build with
a nonzero status. The generator's build smoke test (§7) observes that nonzero status
and reports `BUILD_RED` (`00 §7`) with the renderer's stderr — it MUST NOT report
success (REQ-VERIFY-02). This is the diagram half of the generator-level
"report failure + remediation, never report success on a red build" rule
(tech-spec §7).

### 6.1 `--format both` partial-artifact note (exit 5)

The renderer writes SVG before PNG and is atomic **per single artifact**, but a
`--format both` invocation that succeeds on the SVG and then fails PNG rasterization
(exit 5) leaves the already-written SVG on disk (the renderer's own no-partial-writes
guarantee is per-artifact, not per-invocation —
`specs/diagram-generator/05-cli-and-invocation.md §3.3`,
`00-core-definitions.md §8`). The prebuild **surfaces the exit-5 failure** (fails the
build) rather than masking it because an SVG exists. The doc-site generator's
`PARTIAL_EMISSION` semantics (`00 §7`) are intentionally distinct from the renderer's
per-artifact guarantee: the build is red, the user fixes the spec/environment and
re-runs; the orphaned SVG is harmless and is overwritten on the next successful run.

## 7. End-to-end smoke test (REQ-VERIFY-01, REQ-DIAG-03)

The diagram component is verified **for real**, not by hook presence. During
**Phase 6 (build smoke test)** of the SKILL.md procedure
(`01-architecture-layout.md §4`; gate detailed in `08-rerun-and-verification.md`), the
generator runs the emitted build, which runs the **real** `prebuild`, which invokes
the **vendored** renderer against the committed diagram spec input(s). The smoke test
passes the diagram half only when:

1. `prebuild` exits 0 (every renderer invocation returned exit 0, §6); **and**
2. the expected artifacts exist on disk at their predictable paths
   (`{{DOCS_PKG_DIR}}/public/diagrams/<basename>.<theme>.svg`, §5.1) — confirming the
   wiring **actually produced artifacts**, the explicit REQ-DIAG-03 bar.

If the target repo has no committed diagram spec yet, the generator emits a single
**starter spec** (a minimal valid `DiagramSpec`) into `src/diagrams/` so the smoke
test has a real input to render — the component must demonstrate end-to-end
production, per REQ-DIAG-03, rather than wiring an empty pipeline. The starter spec is
a managed plumbing file (tracked in provenance, never-clobber on re-run).

Cross-reference: the overall smoke-test gate, its `BUILD_RED` reporting, and next-step
output live in `08-rerun-and-verification.md`; this section specifies only what the
**diagram** half contributes to that gate.

## 8. Decline-clean — zero files when declined (REQ-DIAG-01, REQ-USE-01)

When the user declines diagrams (`diagrams: false`, `00 §5`), the generator emits
**zero** diagram files and **zero** hooks:

- No vendored `scripts/diagram-render.mjs` copy.
- No `diagrams` / `prebuild` diagram script entry in `package.json` (if `prebuild`
  exists for the symlink layer only, it contains no diagram invocation).
- No `src/diagrams/` directory or starter spec.
- No `diagramContract` field in `.doc-site-scaffold.json` (it is present **only** when
  diagrams are emitted — `00 §3.2`).
- No reference to the renderer anywhere in the emitted tree.

This is the decline-all invariant (`00 §5`): nothing outside the `diagrams/` group
references it, so omitting the group leaves no dangling hook, config, or reference. A
minimal site (`diagrams=false`, `deploy=[]`, `driftGuard=false`,
`contentMode="native"`) contains only the core scaffold (REQ-USE-01). This is asserted
by a scaffold-output fixture (`10-testing-strategy.md`): the declined-diagrams fixture
must produce a tree byte-identical to the no-diagram baseline.

## Dependencies

Implement/author these first; this document builds directly on them:

- **`00-core-definitions.md`** — the consumed renderer contract (§8: flags, exit
  codes, `CONTRACT_VERSION` `1.0.0`, no `--theme both`); the `{{TOKEN}}` vocabulary
  (§4.1: `{{DOCS_PKG_DIR}}`, `{{ACCENT_LIGHT}}`, `{{ACCENT_DARK}}`, `{{RUNTIME}}`,
  `{{PKG_MANAGER}}`); the provenance manifest (§3: `diagramContract`, `files`); the
  component-selection model (§5: `diagrams` gate, decline-all invariant); the error
  taxonomy (§7: `BUILD_RED`, `HARD_FAIL_IMPOSSIBLE`, `PARTIAL_EMISSION`).
- **`01-architecture-layout.md`** — the `diagrams/` template group and its emit
  condition (§2.2); the **fixed** sibling rel-path
  `../diagram-generator/scripts/diagram-render.mjs` uniform across all five targets
  (§5.2); the SKILL.md phase the component plugs into (§4, Phase 4 emit / Phase 6
  smoke test).
- **The released `diagram-generator` skill (HARD prerequisite, CON-05)** — its frozen
  v1.0.0 contract (`specs/diagram-generator/05-cli-and-invocation.md`) and its
  verbatim, mode-preserved emission of `scripts/diagram-render.mjs` into every adapter
  bundle (`specs/diagram-generator/06-integration-and-packaging.md §5.1`). This must
  be implemented and frozen **before** this component (PRD CON-05, OQ-4 resolved).

Cross-references (not strict prerequisites): `03-core-site-and-manifest.md`
(`passthroughImageService()` per REQ-CORE-03; how the site references the generated
SVGs), `04-content-symlink-layer.md` (shared `prebuild` merge ordering),
`08-rerun-and-verification.md` (the smoke-test gate, re-run pin re-check, never-clobber
of the vendored copy), `10-testing-strategy.md` (the declined-diagrams scaffold
fixture).

## Verification

An implementation matches this spec when:

- [ ] **Fixed rel-path.** The agent reads the renderer at exactly
      `../diagram-generator/scripts/diagram-render.mjs` from the doc-site skill's own
      dir, with no per-target branching; the path resolves to a real file in all five
      `adapters/<target>/` trees.
- [ ] **Pin-check.** Before vendoring, `diagram-render.mjs --version` is run; a `1.0.0`
      match proceeds, any other version aborts the component (no files written) and
      surfaces expected-vs-observed; an unavailable renderer aborts with a missing
      prerequisite report (no embedded fallback).
- [ ] **Provenance.** On success `.doc-site-scaffold.json` records
      `diagramContract: "1.0.0"` and the vendored `scripts/diagram-render.mjs` path →
      sha256; on decline, `diagramContract` is absent.
- [ ] **Vendored copy.** `scripts/diagram-render.mjs` in the target is byte-identical
      to the sibling source (no token substitution) and executable.
- [ ] **Predictable paths.** The emitted prebuild uses `--out-file` (or
      `--out-dir` + `--out-name`); it never uses `--out-dir` alone, so output paths are
      slug-independent.
- [ ] **Light + dark.** Each spec is invoked twice (`--theme light`, `--theme dark`);
      no invocation uses a `--theme both` value.
- [ ] **Failure surfaced.** A renderer nonzero exit (2/3/4/5/6/64) aborts the chained
      `prebuild` and the build smoke test reports `BUILD_RED` with the renderer stderr;
      an exit-5 `--format both` failure that left an SVG is still reported as red, not
      masked.
- [ ] **End-to-end smoke (REQ-DIAG-03).** Running the emitted build executes the real
      prebuild, invokes the vendored renderer, and produces the expected artifact files
      at `public/diagrams/<basename>.<theme>.svg`; the gate fails if no artifact is
      produced.
- [ ] **Decline-clean (REQ-USE-01).** With `diagrams: false`, the emitted tree
      contains no vendored renderer, no diagram script/hook, no `src/diagrams/`, no
      `diagramContract` — byte-identical to the no-diagram baseline (scaffold fixture,
      `10-testing-strategy.md`).
