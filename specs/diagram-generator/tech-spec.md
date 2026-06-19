# Diagram Generator — Technical Specification

> Slug: `diagram-generator` · Stage: forge-2-tech v1 · Based on: PRD v2
> Stack: `bun-typescript` (generic forge profile — language-neutral conventions)

## 1. Overview

`diagram-generator` is a canonical **skill** authored in this repo and emitted to
all five agent targets. It converts a text description — natural language, or an
**engine-neutral diagram spec** (nodes / edges / containers) — into a portable
**SVG** (tier-2: plain `<text>`, opens anywhere) and a **PNG**.

Key architectural decisions:

- **Layout/render engine = Graphviz compiled to WASM (`@viz-js/viz`)** for the
  graph-shaped diagram types, plus a small **direct-SVG** renderer for sequence
  diagrams (REQ-COV-01/02, REQ-OUT-01). No system binary, no headless browser, no
  view-time network — the whole pipeline runs in-process under Bun/Node.
- **PNG rasterization = `@resvg/resvg-js`** (WASM/native npm), in-process
  (REQ-OUT-03).
- **One execution path, two entry modes.** Both conversational and scriptable use
  converge on a single validated `DiagramSpec` → render pipeline. The deliverable
  is a **pre-bundled single-file CLI** (`diagram-render`) that ships verbatim
  inside the skill bundle, so consuming repos (notably `doc-site-plugin`'s
  prebuild) run it with **zero install** (REQ-INV-01/02/03).
- **Theme baked at generation time** — one SVG per theme variant, colors resolved
  inline (REQ-THEME-01, REQ-OUT-01).
- **The scriptable CLI contract is a documented, versioned interface** (REQ-INV-04)
  — this closes `doc-site-plugin`'s OQ-4.

This spec answers HOW. Requirements (WHAT) live in `PRD.md`; every section traces
to REQ IDs.

## 2. Module Structure

Render source lives in the repo's central `src/` tree (typechecked, linted, and
unit-tested with everything else); the **bundled** output is committed into the
skill so it travels to every target.

> **Indicative, not authoritative.** The tree below sketches the principal modules;
> it omits the standalone `schema-gen.ts` and `build-check.ts` scripts and the
> `assets/` directory. The **authoritative full layout** is
> `01-architecture-layout.md` §1 — defer to it for file placement.

```
src/diagram/
  schema.ts          # Zod DiagramSpec (engine-neutral) + inferred types         (REQ-IN-02)
  validate.ts        # input validation + output XML/tier-2/a11y assertions       (REQ-REL-01/02)
  dot-emit.ts        # DiagramSpec → Graphviz DOT (graph-shaped types)            (REQ-COV-01)
  graph-render.ts    # DOT → SVG via @viz-js/viz                                  (REQ-OUT-01)
  sequence-svg.ts    # direct-SVG layout for sequence diagrams                    (REQ-COV-02)
  theme.ts           # semantic palette + light/dark tokens + accent resolution   (REQ-THEME-01)
  svg-postprocess.ts # color/z-order/legend baking, <title>/<desc>/role injection (REQ-A11Y-01)
  png.ts             # SVG → PNG via @resvg/resvg-js                              (REQ-OUT-03)
  render.ts          # orchestration: spec → {svg, png}                           (REQ-OUT-*)
  cli.ts             # arg parsing, IO, exit codes, --version                     (REQ-INV-03/04)
  cli.test.ts, render.test.ts, *.test.ts, __golden__/                            (§8)

skills/diagram-generator/
  SKILL.md                       # procedure + conversational instructions        (CON-01)
  references/
    schema-guide.md              # human-readable engine-neutral spec + examples
    diagram-craft.md             # color taxonomy, z-order, legend, spacing rules
  scripts/
    diagram-render.mjs           # COMMITTED single-file bundle (CLI + WASM inlined)

schemas/
  diagram-input.schema.json      # generated from src/diagram/schema.ts (Zod→JSON Schema)
```

**Public API surface (skill consumers):** exactly one — the `diagram-render` CLI
at `skills/diagram-generator/scripts/diagram-render.mjs`. The `src/diagram/*`
TypeScript modules are internal to this repo and not a consumer contract.

## 3. Technical Decisions

### 3.1 Graphviz-via-WASM + direct-SVG hybrid engine (REQ-OUT-01, REQ-COV-01/02, OQ-2 resolved)

`@viz-js/viz` is Graphviz compiled to WebAssembly. It emits plain-`<text>` SVG
(tier-2 portable, the property D2 lacks) and requires no system binary, satisfying
"installs cleanly anywhere." Graph-shaped types (`architecture`, `flowchart`,
`er`, `state`, `dataflow`) are expressed as DOT and laid out by Graphviz.

Sequence diagrams are Graphviz's weak spot, so `sequence` is rendered by a
dedicated `sequence-svg.ts` that lays out lifelines, messages, and activations
directly as plain-`<text>` SVG. Both paths emit the same SVG shape and flow
through the same post-processing and validation.

**Determinism caveat (REQ-REPRO-01):** Graphviz-WASM output is not inherently
byte-stable (float layout, coordinate rounding, generated-ID order), so the
byte-identical-SVG test (§8) is not free. It requires (a) pinning `@viz-js/viz`,
and (b) a **canonicalization pass** in `svg-postprocess.ts` — stable element/
attribute ordering, fixed coordinate precision, and deterministic element IDs —
applied before the determinism assertion. Exact canonicalization rules are OTQ-6 (§10).

**Alternatives considered:** D2 (best aesthetics, rejected — `<foreignObject>`
fails tier-2 portability); system `dot` binary (rejected — system prerequisite in
every consuming repo); full direct-SVG for all six types (rejected — re-implements
layout Graphviz already does well); elkjs (viable layout, but more drawing code
than reusing Graphviz). User decision recorded.

### 3.2 Engine-neutral input schema, Zod-first (REQ-IN-02, REQ-USE-01)

The structured input is an **engine-neutral** `DiagramSpec` — `diagramType`,
`nodes` (id, label, `role` for semantic color, optional `container`), `edges`
(from, to, label, direction/style), `containers`/groups, and presentation
(`theme`, `accent`, `title`, `description`). It is **not** Graphviz DOT — DOT is an
internal compilation target (`dot-emit.ts`), so users never author the engine's
native DSL (preserves REQ-USE-01). Defined as a Zod schema in
`src/diagram/schema.ts`, following the repo's `src/model.ts` convention. A
committed JSON Schema is generated at `schemas/diagram-input.schema.json`. Note:
`src/schema-gen.ts` is **not** parameterized — it hardwires the `Manifest` object
and a single output path — so emitting a second schema requires **new code**:
either a parameterized refactor of `src/schema-gen.ts` over `(zodSchema,
outputPath)`, or a sibling generator (e.g. `src/diagram/schema-gen.ts`), plus new
`schema:gen`/`schema:check` scripts for the diagram schema wired into `gate`. Only
the `zodToJsonSchema` import is reused as-is.

**Natural-language mode (REQ-IN-01):** the SKILL.md instructs the agent to
translate the user's prose into a `DiagramSpec` JSON, then invoke the same CLI —
no separate NL code path. **REQ-IN-03** ("MUST NOT invent semantic content") is
enforced here by SKILL.md authoring guidance (depict only what the user described);
it is a prompt-discipline constraint, not machine-validatable in v1.

### 3.3 Pre-bundled single-file CLI (REQ-INV-01/02/03, OQ-2 dependency footprint)

The render code plus `@viz-js/viz`, `@resvg/resvg-js`, and the XML validator are
bundled by `bun build` into one self-contained ES module committed at
`skills/diagram-generator/scripts/diagram-render.mjs` (WASM inlined/base64). Skill
`scripts/` ship verbatim to every adapter (`src/discover.ts` `collectOwnedTree`;
`src/targets/_shared.ts` `skillVerbatimRecords`), and `src/publish.ts:118-119`
preserves file mode — so the executable bundle reaches all five target bundles
ready to run with zero install. This is the linchpin of the zero-friction
scriptable contract for arbitrary consuming repos.

### 3.4 Theme baked per-variant (REQ-THEME-01, REQ-OUT-01)

One invocation produces one theme variant; colors are resolved inline at
generation (no view-time `<style>`/media-query reliance, keeping tier-2 identical
rendering everywhere). `theme.ts` holds a semantic palette keyed by node `role`
(seeded from the research's Cocoon taxonomy: frontend/backend/database/security/
bus/…), with light and dark token sets and an `accent` override. To obtain both
light and dark, callers invoke twice; deterministic output names keep both
artifacts side by side (§5).

**Fonts (REQ-OUT-04, REQ-PORT-01):** text uses a single bundled font that is
**subset and embedded as a base64 data-URI** inside each SVG — never a CDN `<link>`
(the Cocoon anti-pattern) and never a bare system-font-family reference (which
renders differently across viewers). This is what makes "opens identically
everywhere" hold in Inkscape/Office/PDF, not just browsers. The font asset is
bundled into the CLI (§3.3); `svg-postprocess.ts` injects the data-URI `@font-face`
into the SVG and rewrites `font-family` references to it. The subset font is part
of the committed bundle and the determinism surface (§3.5).

### 3.5 Two-stage validation, fail loud (REQ-REL-01/02)

1. **Input:** parse against the Zod `DiagramSpec`; on failure print a specific
   message to stderr and exit non-zero — emit nothing.
2. **Output:** after render, assert the SVG is well-formed XML, **tier-2-clean**
   (contains `<text>`, contains no `<foreignObject>`), **structurally valid**
   (explicit `viewBox` + width/height present, coordinates well-formed —
   REQ-OUT-02), **font-portable** (an embedded data-URI font face is present; no
   external font URL — REQ-OUT-04), and **a11y-complete** (`<title>`, `<desc>`,
   `role="img"` present). Any failure → stderr + non-zero exit, no partial artifact
   written.

No automatic retry/self-correction in v1 (PRD OQ-1).

### 3.6 Bundle build + drift guard (mirrors adapters)

A new `build:diagram` script bundles `src/diagram/cli.ts` → the committed
`.mjs`; `build:diagram:check` re-bundles in memory and fails on drift. Both the
diagram input JSON Schema and the bundle are wired into `bun run gate` so a stale
committed bundle or schema fails CI — the same discipline the adapter tree and
manifest schema already use.

## 4. Data Model

`DiagramSpec` (Zod, `src/diagram/schema.ts`) — illustrative shape, exact fields
pinned in forge-3-specs:

```
DiagramSpec {
  diagramType: "architecture" | "flowchart" | "sequence" | "er" | "state" | "dataflow"
  title: string
  description: string                       // → <desc> + accessible text (REQ-A11Y-01)
  theme?: "light" | "dark"                  // default "light"; CLI flag overrides
  accent?: string                           // hex; validated
  nodes: Node[]      // { id, label, role?, container? }
  edges: Edge[]      // { from, to, label?, direction?, style? }
  containers?: Container[]  // { id, label, children: id[] }   (boundaries/groups)
  // sequence-specific (when diagramType="sequence"): participants[], messages[]
}
```

`role` is the semantic-color key (REQ-COV-01). No persistent storage — the spec is
a transient input; artifacts are written to the filesystem.

## 5. API Design — the scriptable contract (REQ-INV-03/04; resolves OQ-3 + doc-site OQ-4)

```
diagram-render <input.json | -> [options]

  --type <architecture|flowchart|sequence|er|state|dataflow>
                         # overrides DiagramSpec.diagramType; else read from input
  --theme <light|dark>   # default light; overrides spec
  --accent <#rrggbb>     # overrides spec
  --format <svg|png|both>   # default svg
  --out-file <path>      # explicit output path; with --format both, the extension
                         #   is swapped per artifact (.svg/.png). Fully caller-controlled.
  --out-name <name>      # explicit base name written into --out-dir (overrides slug)
  --out-dir <dir>        # convenience: deterministic derived names <slug>.<theme>.<ext>
  --version              # print contract version, exit 0
  -                      # read spec JSON from stdin; with no output target, single
                         #   artifact streams to stdout
# Output-path precedence: --out-file > (--out-dir + --out-name) > (--out-dir + slug) > stdout
```

**The four contract dimensions** doc-site-plugin OQ-4 depends on:
1. **Input** — JSON `DiagramSpec` via file path or `-` (stdin).
2. **Output** — consumers get **fully predictable paths** via `--out-file`
   (or `--out-dir` + `--out-name`), so they need no knowledge of slug rules;
   `--out-dir` + derived `<slug>.<theme>.<ext>` is a convenience default, and bare
   stdin→stdout is available for single artifacts. Formats: SVG always available,
   PNG on `--format png|both`. (The slug used by the convenience default is a
   non-load-bearing nicety — consumers pin via the explicit flags.)
3. **Invocable diagram types** — all six of REQ-COV-01/02 via `--type`/spec.
4. **Exit/signaling** — `0` success; non-zero on input-validation or
   output-validation failure, with a specific stderr message. No partial writes.

**Versioning (REQ-INV-04):** `--version` reports a contract version string
(`CONTRACT_VERSION` constant); breaking changes to flags, IO, names, or exit
semantics require a bump so consumers pin against a known release.

## 6. Integration Points

**Depends on (this repo):**
- `tools.manifest.json` — append one `ToolEntry`:
  `{ "name": "diagram-generator", "type": "skill", "source": "skills/diagram-generator", "description": "Converts natural-language or an engine-neutral node/edge/container spec into portable tier-2 SVG and PNG diagrams." }`
  (ToolEntry shape `{name,type,source,description?,targets?}` verified from
  `src/model.ts:37-48`; the Manifest's top-level `config` block is unchanged — only
  `tools[]` gains one entry. `config` is a Manifest field, not part of a ToolEntry.)
- **Diagram input schema generation** — NEW code (parameterized `schema-gen` refactor
  or sibling generator) emitting `schemas/diagram-input.schema.json`, plus new
  `schema:gen`/`schema:check` scripts; reuses only the `zodToJsonSchema` import (§3.2).
- `package.json` scripts — add `build:diagram`, `build:diagram:check`,
  `schema:gen`/`schema:check` coverage for the diagram schema; extend `gate`.
- `src/test/golden.shared.ts` `SAMPLE_RELPATHS` + `src/test/__golden__/<target>/`
  — register the new skill's emitted relpaths per target, else `golden.test.ts`
  (three-way set equality, verified at `golden.test.ts:76-78`) fails. **Per-target
  nuance:** each target transforms the skill differently — e.g. claude/codex
  `skills/diagram-generator/SKILL.md`, gemini `skills/diagram-generator/diagram-generator.md`,
  copilot `instructions/diagram-generator.instructions.md`, cursor
  `rules/diagram-generator.mdc`, with owned `references/`+`scripts/` relocated under
  each target's skill location. Register the full per-target relpath set, not just
  the claude shape.

**Consumed by:** `doc-site-plugin` (REQ-DIAG-02/03, CON-05) — its prebuild invokes
the bundled `diagram-render` CLI per the §5 contract. doc-site-plugin's OQ-4 is
resolved by freezing this contract before its diagram component is implemented
(diagram-generator ships first).

**New external dependencies (devDependencies — bundled, not repo runtime deps):**
`@viz-js/viz`, `@resvg/resvg-js` (pin for PNG stability), and a small XML
well-formedness parser (e.g. `@rgrove/parse-xml`). Current runtime deps (`zod`,
`zod-to-json-schema`, `yaml`, `smol-toml`) are unaffected; `zod` is reused for the
`DiagramSpec` schema.

## 7. Error Handling

- **Input errors** — Zod parse failure → stderr with the offending path/field,
  exit non-zero (REQ-REL-02). No engine invocation.
- **Render errors** — Graphviz/DOT parse errors or sequence-layout failures are
  surfaced verbatim to stderr, exit non-zero.
- **Output-validation errors** — malformed XML, `<foreignObject>` leak, missing
  `<text>`, or missing a11y nodes → stderr, exit non-zero, **no artifact written**
  (REQ-REL-01, REQ-OUT-01/04, REQ-A11Y-01).
- **Filesystem** — `--out-dir` writes are confined to the caller-specified
  directory (REQ-SEC-01); failures (missing dir, permission) → stderr, non-zero.
- Conversational mode surfaces the same stderr messages back through the agent.

## 8. Testing Approach (proves PRD §8 success criteria)

- **Golden SVGs** — one committed golden per diagram type (light + dark);
  `src/diagram/__golden__/`. Regenerated via an explicit script, mirroring
  `regenerate-goldens.ts`.
- **Property assertions** — every emitted SVG: well-formed XML, contains `<text>`,
  contains no `<foreignObject>` (tier-2, REQ-OUT-01), declares explicit `viewBox` +
  width/height (REQ-OUT-02), carries an embedded data-URI font face and references
  no external font/URL (REQ-OUT-04/SEC-02), and has `<title>`/`<desc>`/`role="img"`
  (REQ-A11Y-01).
- **Determinism** — same `DiagramSpec` → **byte-identical SVG** across runs
  (REQ-REPRO-01).
- **PNG** — smoke only: `--format png` yields a valid, non-empty PNG of expected
  dimensions; **not** byte-compared (resvg version/platform variance). `@resvg`
  version pinned to bound drift.
- **CLI contract** — input-from-file and from-stdin, `--out-dir` naming, each
  `--type`, exit-code on bad input and on a forced foreignObject leak, `--version`
  output (REQ-INV-03/04).
- **Emission** — adding the skill keeps `bun run gate` green: updated goldens +
  `SAMPLE_RELPATHS`, drift check passes, bundle drift check passes (REQ-PORT-02).

## 9. Dependencies

| Dependency | Kind | Why |
| --- | --- | --- |
| `@viz-js/viz` | devDep (bundled) | Graphviz-WASM layout/SVG for graph-shaped types (§3.1) |
| `@resvg/resvg-js` | devDep (bundled), **pinned** | SVG→PNG, in-process (§3.4, REQ-OUT-03) |
| `@rgrove/parse-xml` (or equiv) | devDep (bundled) | output XML well-formedness check (§3.5) |
| subset font asset (e.g. a libre sans/mono) | bundled asset | embedded as base64 data-URI for portable text (§3.4, REQ-OUT-04) |
| `zod` | existing runtime | `DiagramSpec` schema (reused) |
| `zod-to-json-schema` | existing runtime | generate `diagram-input.schema.json` |
| `bun build` | toolchain | produce the committed single-file bundle (§3.3/3.6) |

No system binaries; no headless browser; no network at build or view time.

## 10. Open Technical Questions

- **OTQ-1 (golden strategy for the bundle):** the committed `.mjs` inlines WASM and
  is large/opaque. Decide in forge-3-specs whether goldens byte-compare the bundle
  or assert **relpath presence only** (leaving byte-fidelity to `build:diagram:check`
  + the adapter drift guard). Leaning: presence-only in goldens; drift guard owns bytes.
- **OTQ-2 (semantic palette + theme tokens):** exact `role`→color map and
  light/dark token values — seed from the research's Cocoon taxonomy, pin in
  forge-3-specs.
- **OTQ-3 (sequence layout details):** lifeline spacing, activation bars,
  self-messages, and overlap rules for `sequence-svg.ts` — specify in forge-3-specs.
- **OTQ-4 (theme convenience):** whether to add `--theme both` / `--format both`
  combinations as a caller convenience, or require two invocations.
- **OTQ-5 (resvg pin policy):** exact pinned `@resvg/resvg-js` version and the
  PNG-dimension assertion tolerance for CI stability.
- **OTQ-6 (SVG canonicalization for determinism):** exact rules for the
  `svg-postprocess.ts` canonicalization pass that makes Graphviz-WASM output
  byte-stable (element/attribute ordering, coordinate precision, deterministic ID
  scheme) — specify in forge-3-specs (§3.1).
