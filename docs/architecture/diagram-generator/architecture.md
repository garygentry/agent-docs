# Architecture

How `diagram-generator` turns a `DiagramSpec` into a portable diagram image, why it
is built the way it is, and where the integrity guarantees come from. This documents
the **implemented** system (`src/diagram/`), cross-referenced to the design specs
under `specs/diagram-generator/`.

## Design goals (the "why")

Three constraints shape every decision below:

1. **Portability over fidelity.** The output must open identically in a browser,
   Inkscape, Office, LaTeX, and PDF tooling — so the SVG is restricted to a "tier-2"
   subset: plain `<text>` labels, an embedded subset font (base64 data-URI), **no**
   `<foreignObject>`, **no** view-time network (`REQ-OUT-01/04`, `REQ-SEC-02`).
2. **Engine neutrality.** Callers describe _what_ to draw, never _how_. The input is
   an engine-neutral `DiagramSpec`; Graphviz DOT is a private compile target the
   caller never sees (`REQ-IN-02`). This keeps the public contract stable even if the
   layout engine changes.
3. **Determinism.** The same spec must produce **byte-identical** SVG, so output is
   golden-testable and review diffs are meaningful (`REQ-REPRO-01`).

Everything in-process: Graphviz runs as WASM (`@viz-js/viz`), PNG rasterization runs
as WASM (`@resvg/resvg-js`). There is **no system binary, no browser, no network** at
render time — which is what makes the bundle shippable and zero-install.

## The pipeline at a glance

```
DiagramSpec (JSON)
      │
      ▼
  parseSpec ............ Zod parse + cross-field checks (validate.ts)   [CLI boundary]
      │  (typed DiagramSpec)
      ▼
  render(spec, opts) ... orchestration (render.ts)
      │
      ├─ sequence ──────▶ renderSequence ........... direct SVG layout (sequence-svg.ts)
      │
      └─ graph types ──▶ emitDot ▶ renderGraph ..... DOT → SVG via Graphviz-WASM
      │                  (dot-emit.ts) (graph-render.ts)
      ▼
  postProcess .......... color · z-order · legend · a11y · font · canonicalize
      │                  (svg-postprocess.ts)
      ▼
  assertOutputValid .... tier-2 / structural / font / a11y assertions (validate.ts)
      │
      ▼
  RenderResult { svg, width, height, theme, slug }
      │
      └─ (CLI only) renderPng(svg) ▶ PNG buffer (png.ts), then path-confined write
```

### Module map (`src/diagram/`)

| Module                            | Responsibility                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema.ts`                       | The `DiagramSpec` Zod schema, all enums/types, `RenderResult`, and constants (`CONTRACT_VERSION`, `EXIT_CODES`, `SVG_COORD_PRECISION`). The leaf everyone imports. |
| `errors.ts`                       | The typed error hierarchy — one `DiagramError` subclass per failure class, each carrying a stable `code` and derived `exitCode`.                                   |
| `validate.ts`                     | **Input**: `parseSpec` (Zod + cross-field `diagramSuperRefine`). **Output**: `assertOutputValid` (tier-2 / structural / font-portable / a11y assertions).          |
| `dot-emit.ts`                     | Graph-shaped `DiagramSpec` → tier-2-clean Graphviz DOT (no HTML/record labels). Role colors are **not** baked here.                                                |
| `graph-render.ts`                 | DOT → SVG via `@viz-js/viz` (Graphviz-WASM), in-process.                                                                                                           |
| `sequence-svg.ts`                 | Sequence specs → SVG laid out directly (lifelines, message arrows by kind, activation bars). Bypasses Graphviz entirely.                                           |
| `theme.ts`                        | Light/dark palettes, the `NodeRole`→fill map, and accent-override resolution.                                                                                      |
| `svg-postprocess.ts`              | The shared finishing pass (see below). The largest module — it owns determinism.                                                                                   |
| `png.ts`                          | SVG → PNG via `@resvg/resvg-js`, with a dimension-tolerance check. CLI-only.                                                                                       |
| `render.ts`                       | The orchestrator: dispatch → post-process → output-assert → `RenderResult`.                                                                                        |
| `cli.ts`                          | The scriptable contract: arg parsing, input read, theme loop, path-confined writes, exit-code mapping. The bundle entry point.                                     |
| `schema-gen.ts`, `build-check.ts` | Standalone drift guards (schema, bundle). **Not** imported by `cli.ts` — kept out of the shipped bundle.                                                           |

## Key decisions and trade-offs

### Two render paths, one finishing stage

Graph-shaped diagrams (architecture/flowchart/er/state/dataflow) are laid out by
Graphviz, which solves node placement and edge routing far better than hand-rolled
code. Sequence diagrams don't fit a graph layout model, so they're laid out directly
to SVG from ordered participants and messages (`03 §4`). The two paths deliberately
**converge** at `svg-postprocess.ts`, so color baking, a11y, font embedding, and
canonicalization are written **once** and apply identically to both.

### Why DOT is internal, and colors are baked _after_ layout

`dot-emit.ts` emits **no** role colors and **no** HTML/record labels — only plain
geometry with stable role _markers_. Two reasons:

- **Tier-2 safety.** Graphviz HTML-like labels and `record` shapes can produce
  `<foreignObject>` or markup that breaks portability. Emitting plain labels and
  coloring later keeps the DOT (and the resulting SVG) tier-2-clean by construction
  (`03 §2.1`).
- **Theme independence.** Layout is theme-agnostic; the same DOT serves light and
  dark. `svg-postprocess.ts` applies the resolved palette to the role markers after
  layout, so a theme/accent change never re-runs Graphviz.

### The post-process pass owns determinism

`svg-postprocess.ts` runs an ordered sequence (`04 §3`): parse → **semantic color
baking** (role→fill, inlined as attributes, no external CSS) → **z-order** (containers
< edges < nodes < labels) → **legend** placement → **a11y injection** (`<title>`,
`<desc>`, `role="img"`) → **font embedding** (the subset font as a base64 data-URI) →
**canonicalization**. The final canonicalization step is the linchpin of
`REQ-REPRO-01`: it renumbers ids in document order, rounds every coordinate to
`SVG_COORD_PRECISION` (2) decimals, and normalizes attribute ordering and whitespace,
so two renders of one spec are byte-identical.

> **Determinism guardrails.** There is no `Math.random`/`Date.now`/`process.env` on
> any render path; iteration follows spec/insertion order throughout. One documented
> assumption: `canonNumberTokens` rounds every numeric token in geometry attributes,
> which is safe because Graphviz never emits elliptical-arc (`A`/`a`) path commands
> for the in-scope shapes (their flags would be position-significant). If a future
> render path can emit arcs, exclude `d` from token canonicalization — see the note
> in `svg-postprocess.ts`.

### Validation placement: the CLI validates, `render()` trusts

Input validation lives at the **CLI boundary**, not inside `render()`. `cli.ts` calls
`parseSpec` once on the raw JSON; `render()` then trusts the typed `DiagramSpec` and
does **not** re-validate (`03 §5`, `05 §3.1`). This keeps a single validation point
(no double work, no ambiguity about ownership) and lets `render()` be a clean
spec→SVG function. Output validation is the inverse — `render()` always runs
`assertOutputValid` _after_ post-processing, so a malformed artifact can never escape,
and the function never returns or writes a partial result (`REQ-REL-01/02`).

### Fail loud, no auto-retry

Every failure is a typed `DiagramError` subclass with a stable `code` and a fixed
`exitCode`. There is no retry path in v1 (`REQ-REL-02`, `OQ-1` resolved): a bad input
throws `DiagramInputError`, a layout failure throws `DiagramRenderError`, a portability
violation throws `DiagramOutputError`, and so on. The CLI maps the caught error to its
exit code, prints the message to stderr, and emits **no** partial artifact.

### PNG is produced by the CLI, not by `render()`

`render()` returns SVG only. The CLI calls `png.ts:renderPng(svg)` when `--format` is
`png` or `both` (`05 §3.3`). This keeps `render()` pure (SVG in memory, no
rasterization concern) and confines the heavier resvg dependency to the one caller
that needs it. Because a binary PNG must never be streamed to a text stdout, the CLI
**refuses** `--format png`/`both` with no file target, throwing `DiagramUsageError`
→ exit `64`.

## Security model

- **Path confinement (`REQ-SEC-01`).** Every write resolves its destination and
  refuses anything not equal to, or under, the resolved output root — so a `slug` or
  `--out-name` containing `../` cannot escape the chosen directory (`cli.ts`
  `writeArtifact`). Escapes throw `DiagramIoError` → exit `6`.
- **No code execution, no network (`REQ-SEC-02`).** No `child_process`, `eval`,
  `new Function`, or `fetch` on any path. Graphviz and resvg run as in-process WASM;
  resvg loads no system fonts. The embedded font is a static data-URI.

## Packaging & integrity

The feature has **three stages, each with its own guard** (`01 §2`, `06 §4`):

1. **Source** (`src/diagram/*.ts`) — authored, typechecked, ESLint/Prettier'd, and
   unit-tested with the rest of the repo. Never shipped.
2. **Bundle** (`skills/diagram-generator/scripts/diagram-render.mjs`) — produced by
   `bun build` from `cli.ts`, inlining `@viz-js/viz` (WASM, base64), `@resvg/resvg-js`,
   the XML parser, and the subset font into one self-contained file. **Committed.**
   `build:diagram:check` re-bundles in memory and fails CI if the committed copy
   drifts.
3. **Emitted** (`adapters/<target>/…`) — `bun run build` copies the skill (SKILL.md,
   `references/`, and the `scripts/` bundle, **executable mode preserved**) verbatim
   into all five target trees. The whole-tree `build:check` byte-verifies those
   committed trees.

Two drift guards therefore pin the bundle bytes from different angles and move
together: `build:diagram:check` (source→bundle) and `build:check` (bundle→committed
adapter trees). Both are wired into `gate`, alongside `schema:check:diagram` (the
generated `diagram-input.schema.json` vs the Zod source).

### Why the bundle ships verbatim

A consuming repo runs `bun .../diagram-render.mjs <spec.json> …` with **zero install**
— no `node_modules`, no WASM fetch, no font download. That zero-install property is
the foundation of the shared contract (`CON-02`): `doc-site-plugin` consumes the SVG
and pins the CLI's flag/exit/version surface. The bundle is the only artifact that
crosses the repo boundary, so its byte-fidelity is guarded in the two places above.

## Testing strategy (how the guarantees are proven)

- **Golden SVGs** — 12 committed files (6 types × {light, dark}) under
  `src/diagram/__golden__/`, byte-compared on every run; a regeneration script
  refreshes them deterministically (`08 §2–3`).
- **Property assertions** — every golden is re-checked through the _same_
  `assertOutputValid` validators (not re-implemented), proving tier-2 / structural /
  font / a11y properties hold (`08 §4`).
- **Determinism** — a spec rendered twice asserts byte-identical SVG that also
  matches its committed golden (`08 §5`, `REQ-REPRO-01`).
- **PNG smoke** — rasterizes a fixture and asserts a valid PNG within a dimension
  tolerance (smoke-only; resvg is pinned, exact bytes vary by platform) (`08 §6`).
- **CLI contract** — file + stdin input, all six `--type` values, `--format`
  combinations, output-path precedence, `--version`, each `DiagramError`→exit-code
  mapping (including the `RENDER_FAILED` wiring through `main()`), path confinement,
  and PNG-to-stdout refusal; plus an in-process-vs-bundle parity check (`08 §7`).
- **Emission guard** — asserts the skill lands in all five target trees (`08 §8`).

## Related specs

The authoritative design lives in `specs/diagram-generator/`: `00-core-definitions`
(types/constants), `01-architecture-layout` (module tree, deps, scripts),
`02-schema-and-validation`, `03-rendering-engine`, `04-theme-postprocess-png`,
`05-cli-and-invocation`, `06-integration-and-packaging`, `08-testing-strategy`, and
`TRACEABILITY.md`.
