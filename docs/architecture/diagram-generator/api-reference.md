# API Reference

Two public surfaces: the **scriptable CLI contract** (the frozen, versioned interface
consumers pin against) and the **`DiagramSpec` input schema**. A small **programmatic
`render()` API** is also exported for in-process callers. Signatures below are taken
from the implementation (`src/diagram/`); the CLI is documented as the committed
bundle `skills/diagram-generator/scripts/diagram-render.mjs`.

---

## 1. The CLI contract (frozen, `CONTRACT_VERSION = "1.0.0"`)

```
diagram-render <input.json | -> [flags]
diagram-render --version
```

Input is one positional argument: a path to a `DiagramSpec` JSON file, or `-` to read
the spec from **stdin**. `--version` prints `CONTRACT_VERSION` and exits `0`.

### Flags

| Flag         | Values                   | Effect                                            |
| ------------ | ------------------------ | ------------------------------------------------- |
| `--type`     | a `DiagramType`          | Overrides `spec.diagramType`.                     |
| `--theme`    | `light` \| `dark`        | Overrides `spec.theme`. Renders that one variant. |
| `--accent`   | `#rrggbb`                | Overrides `spec.accent` (validated `HexColor`).   |
| `--format`   | `svg` \| `png` \| `both` | Which artifact(s) to produce. Default `svg`.      |
| `--out-dir`  | dir                      | Directory for named/derived artifacts.            |
| `--out-name` | name                     | Explicit base name written into `--out-dir`.      |
| `--out-file` | path                     | Explicit full output path (highest precedence).   |
| `--version`  | —                        | Print `CONTRACT_VERSION` and exit `0`.            |

### Output-path resolution (precedence, highest first)

1. `--out-file <path>` — exact file path.
2. `--out-dir <dir>` + `--out-name <name>` → `<dir>/<name>.<ext>`.
3. `--out-dir <dir>` + derived `slug` → `<dir>/<slug>.<theme>.<ext>`.
4. _(none)_ → SVG to **stdout**.

`--out-file` may not be combined with `--out-name`/`--out-dir`; `--out-name` without
`--out-dir` is rejected (`DiagramUsageError`). A binary **PNG can never go to stdout**:
`--format png`/`both` with no resolved file target is refused with `DiagramUsageError`
→ exit `64`. All writes are **path-confined** — a destination outside the resolved
output root throws `DiagramIoError` (`REQ-SEC-01`).

### Exit codes

From `EXIT_CODES` (`schema.ts`); a successful run exits `0`.

| Code | Name             | Cause                                               |
| ---- | ---------------- | --------------------------------------------------- |
| `0`  | —                | success                                             |
| `2`  | `INPUT_INVALID`  | Zod parse / cross-field validation failed           |
| `3`  | `RENDER_FAILED`  | DOT/Graphviz or sequence layout error               |
| `4`  | `OUTPUT_INVALID` | post-render tier-2/structural/a11y assertion failed |
| `5`  | `PNG_FAILED`     | resvg rasterization failed                          |
| `6`  | `IO_ERROR`       | filesystem write / path-confinement violation       |
| `64` | `USAGE_ERROR`    | bad flags / missing input / PNG-to-stdout           |

On any error the message is written to **stderr** and **no partial artifact** is left
behind.

---

## 2. `DiagramSpec` — the input schema

The engine-neutral input, defined as a Zod schema in `schema.ts` and built with
`.strict()` (unknown keys are rejected). A generated JSON Schema lives at
`schemas/diagram-input.schema.json`.

### Top-level fields

| Field          | Type                   | Required               | Notes                                           |
| -------------- | ---------------------- | ---------------------- | ----------------------------------------------- |
| `diagramType`  | `DiagramType`          | yes                    | one of the six types below                      |
| `title`        | `string` (min 1)       | yes                    | → SVG `<title>` and the heading (`REQ-A11Y-01`) |
| `description`  | `string` (min 1)       | yes                    | → SVG `<desc>` (`REQ-A11Y-01`)                  |
| `theme`        | `"light"` \| `"dark"`  | no (default `"light"`) | CLI `--theme` overrides                         |
| `accent`       | `HexColor` (`#rrggbb`) | no                     | CLI `--accent` overrides                        |
| `nodes`        | `Node[]`               | no (default `[]`)      | graph types; empty for sequence                 |
| `edges`        | `Edge[]`               | no (default `[]`)      | graph types; empty for sequence                 |
| `containers`   | `Container[]`          | no (default `[]`)      | boundary/group clusters                         |
| `participants` | `Participant[]`        | no (default `[]`)      | **sequence only**                               |
| `messages`     | `Message[]`            | no (default `[]`)      | **sequence only**, document order               |

`DiagramType` is one of: `architecture`, `flowchart`, `er`, `state`, `dataflow`,
`sequence`.

**Type/field agreement (enforced):** a `sequence` spec must populate
`participants`/`messages` and leave `nodes`/`edges`/`containers` empty; the five
graph types must do the inverse. Violations throw `DiagramInputError`.

### `Node`

| Field   | Type                                                  | Notes                                                |
| ------- | ----------------------------------------------------- | ---------------------------------------------------- |
| `id`    | `NodeId`                                              | unique; referenced by edges and `Container.children` |
| `label` | `string` (min 1)                                      | plain text, no markup                                |
| `role`  | `NodeRole`?                                           | semantic color key; omitted → `default`              |
| `shape` | `"box"\|"rounded"\|"cylinder"\|"diamond"\|"ellipse"`? | per-type default if omitted                          |

`NodeRole`: `default`, `frontend`, `backend`, `database`, `queue`, `cache`,
`external`, `security`, `gateway`, `storage`, `compute`.

### `Edge`

| Field        | Type                                   | Notes                                      |
| ------------ | -------------------------------------- | ------------------------------------------ |
| `from`, `to` | `NodeId`                               | both must exist in `nodes` (cross-checked) |
| `label`      | `string`?                              | optional connector label                   |
| `direction`  | `"forward"\|"back"\|"both"\|"none"`?   | default `forward`                          |
| `style`      | `"solid"\|"dashed"\|"dotted"\|"bold"`? | default `solid`                            |

### `Container`

| Field      | Type             | Notes                                               |
| ---------- | ---------------- | --------------------------------------------------- |
| `id`       | `NodeId`         | unique (namespace shared with nodes for ref checks) |
| `label`    | `string` (min 1) | boundary label                                      |
| `children` | `NodeId[]`       | each must exist in `nodes`                          |
| `parent`   | `NodeId`?        | optional nesting; must exist in `containers`        |

### `Participant` (sequence)

| Field   | Type             | Notes                          |
| ------- | ---------------- | ------------------------------ |
| `id`    | `NodeId`         | unique; referenced by messages |
| `label` | `string` (min 1) | lifeline header                |
| `role`  | `NodeRole`?      | header color                   |

### `Message` (sequence)

| Field        | Type                       | Notes                                  |
| ------------ | -------------------------- | -------------------------------------- |
| `from`, `to` | `NodeId`                   | both must exist in `participants`      |
| `label`      | `string` (min 1)           | message label                          |
| `kind`       | `"sync"\|"async"\|"reply"` | default `sync` (solid / open / dashed) |
| `activate`   | `boolean`?                 | draws an activation bar on the target  |

### Cross-field invariants (beyond the per-field schema)

`parseSpec` additionally enforces (`02 §2`):

1. **Referential integrity** — every `from`/`to`/`children`/`parent` references an id
   that exists in its collection.
2. **Unique ids** — across nodes, containers, and participants, with no node/container
   collision.
3. **Type/field agreement** — the sequence-vs-graph population rule above.

Failures throw `DiagramInputError` with the offending JSON path in `detail`.

---

## 3. Programmatic `render()` (in-process)

For callers embedding the renderer in-process (the CLI is the usual entry point):

```ts
import { render } from "./render.js";
import { parseSpec } from "./validate.js";

interface RenderOptions {
  theme: Theme; // the variant to bake into this artifact
  accent?: HexColor; // optional override; falls back to spec.accent
}

interface RenderResult {
  svg: string; // validated, tier-2-portable SVG markup
  width: number; // intrinsic px width (mirrored into width/viewBox)
  height: number; // intrinsic px height
  theme: Theme; // the baked variant
  slug: string; // derived from title, used for --out-dir naming
}

async function render(spec: DiagramSpec, opts: RenderOptions): Promise<RenderResult>;
```

`render()` does **not** validate input — validate at the boundary first:

```ts
const spec = parseSpec(JSON.parse(rawJson)); // throws DiagramInputError on bad input
const result = await render(spec, { theme: "dark" });
// result.svg has already passed assertOutputValid
```

PNG is produced separately by the CLI via `renderPng(svg)` in `png.ts`; `render()`
never rasterizes.

---

## 4. Error hierarchy (`errors.ts`)

All errors extend `DiagramError`, which carries a stable `code` (a `DiagramErrorCode`)
and a derived `exitCode` (from `EXIT_CODES`), plus optional `detail`.

| Class                | `code`           | `exitCode` |
| -------------------- | ---------------- | ---------- |
| `DiagramError`       | (base)           | —          |
| `DiagramInputError`  | `INPUT_INVALID`  | `2`        |
| `DiagramRenderError` | `RENDER_FAILED`  | `3`        |
| `DiagramOutputError` | `OUTPUT_INVALID` | `4`        |
| `DiagramPngError`    | `PNG_FAILED`     | `5`        |
| `DiagramIoError`     | `IO_ERROR`       | `6`        |
| `DiagramUsageError`  | `USAGE_ERROR`    | `64`       |

---

## 5. Constants (`schema.ts`)

| Constant              | Value     | Purpose                                                          |
| --------------------- | --------- | ---------------------------------------------------------------- |
| `CONTRACT_VERSION`    | `"1.0.0"` | the versioned contract surface (`--version`); consumers pin this |
| `EXIT_CODES`          | see §1    | `DiagramErrorCode` → process exit code                           |
| `DEFAULT_FORMAT`      | `"svg"`   | default `--format`                                               |
| `DEFAULT_THEME`       | `"light"` | default theme                                                    |
| `SVG_COORD_PRECISION` | `2`       | decimal places coordinates are rounded to (determinism)          |

---

## 6. Output validation (`validate.ts`)

`assertOutputValid(svg: string): void` aggregates the tier-2 portability and
accessibility guarantees, throwing `DiagramOutputError` on any violation. It is run by
`render()` after post-processing and reused directly by the property tests. The
sub-assertions:

- **well-formed** — parses as XML (`@rgrove/parse-xml`);
- **tier-2** — no `<foreignObject>`; labels are plain `<text>`;
- **structural** — root `<svg>` has explicit `viewBox` + `width` + `height`;
- **font-portable** — any embedded font is a data-URI; no external/network href;
- **a11y** — `<title>`, `<desc>`, and `role="img"` are present.
