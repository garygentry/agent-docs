# diagram-generator

Turn a natural-language request — or a structured JSON spec — into a polished,
**portable** diagram image (SVG, and PNG when you ask for it), with **no runtime
renderer and no view-time network**. Architecture diagrams, flowcharts, sequence
diagrams, ER diagrams, state machines, and data-flow diagrams all render from one
engine-neutral input shape.

This feature ships two ways that converge on the **same** rendering code:

- a **skill** (`skills/diagram-generator/`) an agent invokes conversationally —
  it authors a `DiagramSpec` from the user's prose and runs the renderer;
- a **scriptable CLI** (`skills/diagram-generator/scripts/diagram-render.mjs`) — a
  single self-contained bundle (Graphviz-WASM + rasterizer + subset font all
  inlined) that any repo can run **zero-install**.

> This document is the **architecture reference** for developers maintaining or
> extending the feature. For the input format itself, see
> [`api-reference.md`](./api-reference.md); for how the pieces fit together and why,
> see [`architecture.md`](./architecture.md).

## What it does

- **Engine-neutral input.** You describe _what_ to draw with a `DiagramSpec`
  (nodes / edges / containers, or participants / messages for sequences) — never a
  Graphviz DSL. The renderer compiles that to its internal engine target. The spec
  is the stable contract; the engine is an implementation detail (`REQ-IN-02`).
- **Tier-2-portable output.** Every SVG uses plain `<text>` labels and an embedded
  subset font as a base64 data-URI — **no `<foreignObject>`, no CDN fonts, no
  scripts**. The result opens identically in a browser, Inkscape, Office, LaTeX, and
  PDF pipelines (`REQ-OUT-01/04`, `REQ-SEC-02`).
- **Six diagram types, two render paths.** The five graph-shaped types
  (architecture / flowchart / er / state / dataflow) go through Graphviz-WASM; the
  sequence type is laid out directly to SVG. Both finish in one shared post-process
  pass (`REQ-COV-01/02`).
- **Deterministic.** The same spec renders **byte-identical** SVG every time
  (canonicalized coordinates, ids, attribute order), so output is golden-testable
  and diff-stable (`REQ-REPRO-01`).
- **A frozen, versioned scriptable contract.** The CLI's flags, output-path rules,
  exit codes, and `--version` (`CONTRACT_VERSION = "1.0.0"`) are a stable interface
  that consuming repos — notably `doc-site` — pin against (`CON-02`,
  `REQ-INV-01..04`).
- **Light/dark + accent theming** (`REQ-THEME-01`) and **accessibility built in**:
  every diagram carries `<title>`, `<desc>`, and `role="img"` (`REQ-A11Y-01`).

## Quick start

### Conversational (via the skill)

The agent authors a `DiagramSpec` from the user's request and runs the renderer.
The skill's discipline is **depict only what the user described** — it never invents
components (`REQ-IN-03`). See `skills/diagram-generator/SKILL.md`.

### Scriptable (zero-install CLI)

```bash
# spec.json holds a DiagramSpec; renders one SVG per requested theme
bun skills/diagram-generator/scripts/diagram-render.mjs spec.json \
  --type architecture --theme dark --format svg --out-dir ./out

# read from stdin, both formats, explicit name
cat spec.json | bun skills/diagram-generator/scripts/diagram-render.mjs - \
  --format both --out-dir ./out --out-name login-flow

# print the frozen contract version a consumer pins against
bun skills/diagram-generator/scripts/diagram-render.mjs --version   # -> 1.0.0
```

Output files are named `<slug>.<theme>.<ext>` (e.g. `login-flow.dark.svg`) unless
you override with `--out-file`/`--out-name`. The full flag and precedence table is
in [`api-reference.md`](./api-reference.md).

A minimal architecture spec:

```json
{
  "diagramType": "architecture",
  "title": "Web Service",
  "description": "Browser talks to an API behind a gateway.",
  "nodes": [
    { "id": "web", "label": "Browser", "role": "frontend" },
    { "id": "api", "label": "API", "role": "backend" },
    { "id": "db", "label": "Postgres", "role": "database" }
  ],
  "edges": [
    { "from": "web", "to": "api" },
    { "from": "api", "to": "db" }
  ]
}
```

## Key concepts

| Concept                  | What it is                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`DiagramSpec`**        | The engine-neutral input: `diagramType`, `title`, `description`, plus `nodes`/`edges`/`containers` (graph types) or `participants`/`messages` (sequence). Validated by Zod + cross-field checks. |
| **Tier-2 portability**   | The output contract: plain `<text>`, embedded font, no `<foreignObject>`, no network. Enforced by output assertions on every render.                                                             |
| **Two render paths**     | Graph types → DOT → Graphviz-WASM → SVG; sequence → direct SVG layout. They merge at the post-process stage.                                                                                     |
| **Post-process pass**    | One ordered stage that bakes role colors, enforces z-order, draws the legend, injects a11y, embeds the font, and canonicalizes for determinism.                                                  |
| **The committed bundle** | `scripts/diagram-render.mjs` — `cli.ts` bundled with WASM + font inlined. The only artifact that ships; a drift guard keeps it in sync with source.                                              |
| **`NodeRole`**           | Semantic color key (`frontend`, `backend`, `database`, `queue`, `cache`, `external`, `security`, `gateway`, `storage`, `compute`, `default`) → theme palette fill.                               |

## Package layout

| Location                                              | Description                                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/diagram/*.ts`                                    | The render source — typechecked, linted, unit-tested with the rest of the repo. **Not shipped.**                  |
| `src/diagram/cli.ts`                                  | The CLI / scriptable contract; the bundle entry point.                                                            |
| `skills/diagram-generator/SKILL.md`                   | The conversational procedure + the `REQ-IN-03` "depict only what was described" discipline.                       |
| `skills/diagram-generator/references/`                | `schema-guide.md` (DiagramSpec with worked examples) and `diagram-craft.md` (color/z-order/legend/spacing rules). |
| `skills/diagram-generator/scripts/diagram-render.mjs` | The committed, self-contained bundle (WASM + font inlined). Emitted verbatim to all 5 adapter targets.            |
| `schemas/diagram-input.schema.json`                   | JSON Schema generated from the Zod `DiagramSpec` (drift-guarded).                                                 |

## When to use it

- You need a diagram **as an image** that renders identically everywhere (web, print,
  office docs) with no fonts to install and no scripts to trust.
- You want diagrams **generated from data or prose deterministically** — in a build
  step, a docs pipeline, or an agent conversation.
- You're building a consumer (like `doc-site`) that needs a **stable,
  versioned** rendering CLI it can pin against.

## When NOT to use it

- **You need interactive or animated diagrams.** Output is static SVG/PNG by design.
- **You want to edit or round-trip an existing diagram.** This renders _from_ a spec;
  it does not parse or modify existing SVGs.
- **You want the tool to invent architecture for you.** It depicts only what the
  spec/prose describes — it will not author semantic content (`REQ-IN-03`).
- **You need cloud-provider icon sets** (AWS/GCP/Azure glyphs). Out of scope for v1;
  nodes are colored boxes keyed by `NodeRole`, not branded icons.

## Further reading

- [Architecture](./architecture.md) — render pipeline, the two paths, determinism, packaging
- [API Reference](./api-reference.md) — `DiagramSpec`, the CLI contract, exit codes, the `render()` API
