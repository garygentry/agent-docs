# 04 — Theme, SVG Post-Processing & PNG

This document specifies the three modules that turn the **raw, structure-only** SVG
produced by the render path (`03-rendering-engine.md` — Graphviz-WASM for graph
types, direct-SVG for sequence) into the **final tier-2-portable artifact**, and
then into a PNG:

- `src/diagram/theme.ts` — the semantic palette and light/dark token sets, plus
  accent override resolution (resolves **OTQ-2**).
- `src/diagram/svg-postprocess.ts` — the post-process passes: semantic color
  baking, z-order enforcement, legend placement, a11y injection, font embedding,
  and the determinism **canonicalization** pass (resolves **OTQ-6**).
- `src/diagram/png.ts` — SVG → PNG rasterization in-process (resolves **OTQ-5**).

Module placement is fixed by `01-architecture-layout.md` §1 (`src/diagram/`). The
raw SVG these modules consume carries the role/class markers the render path emits:
each node has `class="role-<role>"` (default `role-default`), container clusters
have `class="container"`, and text uses the placeholder `font-family="DiagramSans"`
(`03-rendering-engine.md` §2.5, §4.2). The raw SVG is **not** yet tier-2-complete;
this document makes it so. Validation of the result is `02-schema-and-validation.md`
§3 and is invoked by `render.ts` **after** `postProcess` (`03-rendering-engine.md`
§5).

## Requirement Coverage

| REQ ID       | Requirement                                                                                        | Section            |
| ------------ | -------------------------------------------------------------------------------------------------- | ------------------ |
| REQ-THEME-01 | Light/dark variants + configurable accent color                                                    | 2 (all)            |
| REQ-COV-01   | Semantic component coloring, z-order, legend-outside-boundary                                      | 2.2, 3.2, 3.3, 3.4 |
| REQ-A11Y-01  | `<title>`/`<desc>`/`role="img"` injected                                                           | 3.5                |
| REQ-OUT-04   | No view-time network; font embedded as data-URI                                                    | 3.6                |
| REQ-PORT-01  | Artifacts portable across viewers; embedded font + inline color render identically with no network | 3.6, 3.7           |
| REQ-OUT-03   | PNG rasterization at build time                                                                    | 4                  |
| REQ-REPRO-01 | Deterministic, byte-stable SVG (canonicalization, OTQ-6)                                           | 3.7                |

> **Resolves:** OTQ-2 (§2), OTQ-5 (§4), OTQ-6 (§3.7).

## 1. The `ResolvedPalette` render type

`ResolvedPalette` is an **internal render-only type** — it is produced by
`resolveTheme` and consumed only by `svg-postprocess.ts`. It is **not** part of the
engine-neutral input contract and not a consumer-facing surface (the only consumer
contract is the CLI, `05-cli-and-invocation.md`). It therefore lives **here** in
`theme.ts`, not in `00-core-definitions.md`.

> **Placement note (for the foundation author):** `00-core-definitions.md` fixes
> only the _keys_ of the palette (`NodeRole`, `Theme`) and explicitly forward-refs
> the _values_ and the resolved shape to this document (`00` §4). If a future
> document needs `ResolvedPalette` (none in this suite does), promoting it into
> `00` would be reasonable; for now it is defined and exported here as internal.

```typescript
import type { HexColor, NodeRole, Theme } from "./schema.js";

/** The three inlined colors applied to one node by its semantic role (REQ-COV-01). */
export interface RoleColors {
  /** Box fill color, inlined as the SVG `fill` of the node's shape (`<polygon>`/`<ellipse>`/`<path>`). */
  fill: HexColor;
  /** Box border color, inlined as the SVG `stroke` of the node's shape. */
  stroke: HexColor;
  /** Label color, inlined as the `fill` of the node's `<text>` elements. */
  text: HexColor;
}

/**
 * The fully resolved color set for one theme variant, after accent override. The
 * `roles` map is total over every `NodeRole` key (00 §2.2) — there is no missing
 * role, so color baking (§3.2) never falls through. Base tokens color the canvas,
 * edges, container boundaries, and the legend.
 */
export interface ResolvedPalette {
  /** Which variant this palette was resolved for (mirrors the baked SVG). */
  theme: Theme;
  /** Per-role box/border/label colors; total over all `NodeRole` values. */
  roles: Record<NodeRole, RoleColors>;
  /** Page/canvas background fill (the root `<svg>` backdrop rect). */
  background: HexColor;
  /** Surface fill for chrome panels (legend box, header band). */
  surface: HexColor;
  /** Default edge/connector stroke color (REQ-COV-01 arrows). */
  edge: HexColor;
  /** Default label/text color for non-node text (edge labels, legend text, titles). */
  label: HexColor;
  /** Container/boundary cluster stroke color (dashed boundary boxes). */
  boundary: HexColor;
  /** The resolved accent color — the supplied `accent` or the variant default. */
  accent: HexColor;
}
```

## 2. `src/diagram/theme.ts` — semantic palette + tokens + accent (REQ-THEME-01, OTQ-2)

The palette is **seeded from the research's Cocoon taxonomy** (`.reference/research.md`:
frontend cyan `#22d3ee`, backend emerald, database violet, security rose, message
bus orange) and extended to the full closed `NodeRole` set fixed in
`00-core-definitions.md` §2.2: `default`, `frontend`, `backend`, `database`,
`queue`, `cache`, `external`, `security`, `gateway`, `storage`, `compute`.

Colors are baked **inline** at generation time (tech-spec §3.4) — there is no
view-time `<style>` or media query — so the chosen hex values must read correctly
on their own theme background. Light-variant roles are saturated fills on near-white
boxes with dark text; dark-variant roles are translucent-feeling deep fills on a
slate canvas with light text. All role `text` colors are chosen against their own
`fill` for legibility (slate-900 `#0f172a` on light fills, slate-50 `#f8fafc` on
dark fills) so node labels clear a WCAG AA contrast bar.

### 2.1 Light token set (resolves OTQ-2, light)

Base tokens (light):

| Token              | Hex       | Role in render                                  |
| ------------------ | --------- | ----------------------------------------------- |
| `background`       | `#ffffff` | canvas backdrop                                 |
| `surface`          | `#f1f5f9` | legend box / chrome panels                      |
| `edge`             | `#475569` | connector arrows                                |
| `label`            | `#0f172a` | edge labels, legend text, title                 |
| `boundary`         | `#94a3b8` | dashed container boundaries                     |
| `accent` (default) | `#2563eb` | accent-derived tokens when no `accent` supplied |

Role colors (light) — `{fill, stroke, text}`:

| `NodeRole` | fill      | stroke    | text      |
| ---------- | --------- | --------- | --------- |
| `default`  | `#e2e8f0` | `#94a3b8` | `#0f172a` |
| `frontend` | `#22d3ee` | `#0891b2` | `#0f172a` |
| `backend`  | `#34d399` | `#059669` | `#0f172a` |
| `database` | `#a78bfa` | `#7c3aed` | `#0f172a` |
| `queue`    | `#fb923c` | `#ea580c` | `#0f172a` |
| `cache`    | `#f87171` | `#dc2626` | `#0f172a` |
| `external` | `#cbd5e1` | `#64748b` | `#0f172a` |
| `security` | `#fb7185` | `#e11d48` | `#0f172a` |
| `gateway`  | `#fbbf24` | `#d97706` | `#0f172a` |
| `storage`  | `#5eead4` | `#0d9488` | `#0f172a` |
| `compute`  | `#93c5fd` | `#2563eb` | `#0f172a` |

### 2.2 Dark token set (resolves OTQ-2, dark)

Base tokens (dark) — the slate canvas honors the Cocoon `#020617`/slate convention:

| Token              | Hex       | Role in render                                  |
| ------------------ | --------- | ----------------------------------------------- |
| `background`       | `#020617` | canvas backdrop                                 |
| `surface`          | `#0f172a` | legend box / chrome panels                      |
| `edge`             | `#94a3b8` | connector arrows                                |
| `label`            | `#e2e8f0` | edge labels, legend text, title                 |
| `boundary`         | `#475569` | dashed container boundaries                     |
| `accent` (default) | `#60a5fa` | accent-derived tokens when no `accent` supplied |

Role colors (dark) — `{fill, stroke, text}`:

| `NodeRole` | fill      | stroke    | text      |
| ---------- | --------- | --------- | --------- |
| `default`  | `#1e293b` | `#475569` | `#f8fafc` |
| `frontend` | `#0e7490` | `#22d3ee` | `#f8fafc` |
| `backend`  | `#047857` | `#34d399` | `#f8fafc` |
| `database` | `#6d28d9` | `#a78bfa` | `#f8fafc` |
| `queue`    | `#c2410c` | `#fb923c` | `#f8fafc` |
| `cache`    | `#b91c1c` | `#f87171` | `#f8fafc` |
| `external` | `#334155` | `#64748b` | `#f8fafc` |
| `security` | `#be123c` | `#fb7185` | `#f8fafc` |
| `gateway`  | `#b45309` | `#fbbf24` | `#f8fafc` |
| `storage`  | `#0f766e` | `#5eead4` | `#f8fafc` |
| `compute`  | `#1d4ed8` | `#93c5fd` | `#f8fafc` |

### 2.3 Accent override resolution

When the caller supplies an `accent` (`HexColor` from `00` §2.1, validated at input
parse, REQ-THEME-01), it **replaces the accent-derived tokens** in the resolved
palette. The accent is a brand color for the _chrome_, not a re-coloring of every
node:

1. `palette.accent` is set to the supplied accent (else the variant default above).
2. The **edge** color is set to the accent (connectors adopt the brand color).
3. The **`default` role's `stroke`** is set to the accent so untyped boxes pick up
   the brand outline.

Semantic role _fills_ are **not** overridden by accent — role colors carry meaning
(REQ-COV-01) and must stay stable across brands. This keeps the accent a tasteful
brand tint, not a destruction of the semantic palette.

### 2.4 Implementation

```typescript
import type { HexColor, NodeRole, Theme } from "./schema.js";
// RoleColors/ResolvedPalette are declared in §1 of this same module (theme.ts).

/** Frozen light/dark token tables — the §2.1/§2.2 values. Internal constant. */
const PALETTES: Record<Theme, ResolvedPalette> = {
  light: {
    /* … the §2.1 tables, accent "#2563eb" … */
  } as ResolvedPalette,
  dark: {
    /* … the §2.2 tables, accent "#60a5fa" … */
  } as ResolvedPalette,
};

/**
 * Resolve the full color palette for one theme variant, applying an optional
 * accent override (REQ-THEME-01, OTQ-2). The returned palette is **total** over
 * every `NodeRole` so color baking (§3.2) never misses a role. Pure and
 * side-effect-free; the same inputs always yield the same palette (REQ-REPRO-01).
 *
 * @param theme - The variant to resolve (`"light"` | `"dark"`). The CLI has
 *   already collapsed spec-vs-flag precedence to a single value (05 §2).
 * @param accent - Optional `#rrggbb` accent (already validated as `HexColor`,
 *   00 §2.1). When present it replaces the accent-derived tokens per §2.3.
 * @returns A deep-cloned, total `ResolvedPalette`; the caller may not mutate the
 *   frozen `PALETTES` source.
 */
export function resolveTheme(theme: Theme, accent?: HexColor): ResolvedPalette {
  const base = structuredClone(PALETTES[theme]);
  if (accent !== undefined) {
    base.accent = accent;
    base.edge = accent;
    base.roles.default.stroke = accent;
  }
  return base;
}
```

**Error handling:** `resolveTheme` does not throw. `theme` is constrained to the
`Theme` enum (`00` §2.1) by the time it reaches here, and `accent` is a validated
`HexColor` (or absent). A `theme` outside the enum is a programming error (caught by
the typechecker); there is no runtime guard, matching the repo's trust of validated
input. An invalid `accent` cannot reach this function — it fails at input parse
(`DiagramInputError`, `00` §5).

### 2.5 Example

```typescript
const p = resolveTheme("dark", "#ff6600");
p.roles.database.fill; // "#6d28d9"  (semantic, unchanged by accent)
p.edge; // "#ff6600"  (accent-overridden)
p.accent; // "#ff6600"
p.background; // "#020617"
```

## 3. `src/diagram/svg-postprocess.ts` — the post-process passes

`postProcess` is the single entry point. It first resolves the color palette
internally — `const palette = resolveTheme(opts.theme, opts.accent ?? opts.spec.accent)`
(§2) — so callers pass a theme, not a palette; the `palette.*` references in the
passes below are this internally-resolved value. It then applies the passes **in the
order below** — color/z-order/legend/a11y/font are content passes; canonicalization
is the **final** pass so it normalizes everything the earlier passes added, producing
a byte-stable result (REQ-REPRO-01). Output assertions (`02` §3) run afterward, in
`render.ts`.

```typescript
import type { DiagramSpec, HexColor, Theme } from "./schema.js";
import { resolveTheme } from "./theme.js"; // §2 — postProcess resolves the palette internally
import { DiagramOutputError } from "./errors.js";

/** Options for one post-process call (one theme variant). */
export interface PostProcessOptions {
  /** The theme variant to bake (REQ-THEME-01); used to resolve the palette (§2). */
  theme: Theme;
  /** Optional validated accent override; falls back to the variant default (§2.3). */
  accent?: HexColor;
  /** The validated DiagramSpec; `title`/`description` feed a11y (§3.5), `nodes`/`containers` the legend (§3.4). */
  spec: DiagramSpec;
  /** Intrinsic width from the render path (sequence path supplies it; graph path passes 0 and §3.4/§3.7 derive it from the SVG). */
  width: number;
  /** Intrinsic height (same convention as `width`). */
  height: number;
}

/** The post-process result: final SVG plus its authoritative dimensions and slug. */
export interface PostProcessResult {
  /** The final tier-2-portable, canonicalized SVG markup. */
  svg: string;
  /** Authoritative artifact width after legend expansion/canonicalization (REQ-OUT-02). */
  width: number;
  /** Authoritative artifact height (REQ-OUT-02). */
  height: number;
  /** Filename slug derived from `spec.title` (00 §3.2 / 05 §3 slug rule). */
  slug: string;
}

/**
 * Transform the raw, structure-only SVG from the render path
 * (03-rendering-engine.md) into the final tier-2-portable SVG: semantic color
 * baked inline, z-order enforced, legend placed, `<title>`/`<desc>`/`role="img"`
 * injected, the subset font embedded as a data-URI, and the document canonicalized
 * for determinism. It resolves the color palette internally via `resolveTheme`
 * (§2) from `opts.theme`/`opts.accent` — callers pass the theme, not a palette. The
 * result still must pass output validation (02 §3) — this function produces, it does
 * not assert.
 *
 * @param rawSvg - A single `<svg>…</svg>` document with plain `<text>`, carrying
 *   `class="role-<role>"` on nodes and `class="container"` on clusters
 *   (03 §2.5, §4.1). No color, font, or a11y nodes yet.
 * @param opts - `{ theme, accent?, spec, width, height }` (see `PostProcessOptions`).
 * @returns `{ svg, width, height, slug }` — the final SVG, its authoritative
 *   dimensions (after legend expansion + canonicalization), and the artifact slug.
 * @throws {DiagramOutputError} (code `OUTPUT_INVALID`) only if the raw SVG cannot
 *   be parsed into a DOM for processing (a structural failure upstream). Content
 *   passes do not throw; the dedicated output assertions (02 §3) report tier-2 /
 *   a11y / font / viewBox violations.
 */
export function postProcess(rawSvg: string, opts: PostProcessOptions): PostProcessResult;
```

The passes operate on a parsed SVG DOM (the bundled XML parser, `@rgrove/parse-xml`,
`01` §4) and re-serialize once at the end (the canonical serializer, §3.7). The
following subsections specify each pass.

### 3.1 Parse

Parse `rawSvg` into a mutable element tree. A parse failure here means the render
path emitted malformed XML — a bug, not user error — so it is wrapped as
`DiagramOutputError("raw SVG is not well-formed XML", <parser message>)`. All
subsequent passes mutate this tree; there is exactly one serialization (§3.7).

### 3.2 Semantic color baking (REQ-COV-01)

Map each node's role marker to inline colors from `palette.roles`:

- For every element carrying `class="role-<role>"` (nodes; participant headers on
  the sequence path, `03` §4.1), look up `colors = palette.roles[<role>]`. Because
  `resolveTheme` returns a **total** map (§2), every role resolves; an unrecognized
  class (which validation forbids) falls back to `palette.roles.default`.
- Within that element's subtree, set the shape's `fill = colors.fill` and
  `stroke = colors.stroke` (Graphviz node shapes are `<polygon>`/`<ellipse>`/`<path>`;
  the sequence header is a `<rect>`). Set every descendant `<text>` element's
  `fill = colors.text`.
- Edges: every edge `<path>`/`<polygon>` (Graphviz emits edges in `class="edge"`
  groups) gets `stroke = palette.edge`; arrowhead `<polygon>` gets
  `fill = palette.edge`. Edge-label `<text>` gets `fill = palette.label`.
- Container clusters (`class="container"`): boundary `<polygon>` gets
  `stroke = palette.boundary`, `fill = "none"` (or `palette.surface` at low opacity
  — choose `fill="none"` for tier-2 simplicity), and `stroke-dasharray="6 4"` for
  the dashed-boundary convention (research §139). Cluster label `<text>` gets
  `fill = palette.label`.
- A root backdrop `<rect>` covering the full `viewBox` is inserted **first** in
  document order with `fill = palette.background`.

Colors are written as inline presentation attributes (not CSS) so they survive in
every tier-2 viewer (Inkscape/Office/PDF), per REQ-OUT-01/04.

### 3.3 Z-order enforcement (REQ-COV-01)

REQ-COV-01 requires connection arrows **behind** boxes and labels **on top**.
Graphviz already paints edges before nodes when edges are declared before node
statements, and the render path (`03` §2) declares edges in a leading
`subgraph cluster_edge`/edge block — but this pass **asserts and enforces** the
invariant rather than trusting it:

1. Collect the root drawing groups: the backdrop rect (§3.2), edge groups
   (`class="edge"`), container groups (`class="container"`), node groups
   (`class~="role-"`), and the legend group (§3.4).
2. Re-order children of the root `<g>` to this **fixed paint order** (back → front):
   `backdrop → containers → edges → nodes → node-labels → legend`. Node label
   `<text>` lives inside its node group, so it naturally paints after the node box;
   no separate label layer is needed beyond ensuring nodes come after edges.
3. The sequence path (`03` §4) already draws lifelines/activations before arrows and
   arrows before labels; this re-order is a no-op there but is applied uniformly so
   both paths share one guarantee.

This pass is deterministic (a stable partition by class, original order preserved
within each band) and is what makes the "arrows routed behind boxes" inspectable
property hold (REQ-COV-01, PRD §3.2).

### 3.4 Legend placement (REQ-COV-01)

A legend is emitted **only** when the diagram uses more than one distinct semantic
role across its nodes (a single-role diagram needs no key). The legend is
constructed **here** (the render path deliberately omits it — `03` §2.5) so it can
be placed with full knowledge of the final canvas bounds:

- Compute the distinct roles present (excluding `default`) from `spec.nodes`
  (and `spec.participants` for sequence). One legend row per role: a small swatch
  `<rect>` filled with that role's `fill`/`stroke` and a `<text>` label naming the
  role (title-cased).
- The legend is placed **outside all boundary boxes** (REQ-COV-01): the canvas
  `viewBox` is **expanded** (width grows by the legend column width + gutter) and
  the legend group is positioned in the new right-hand margin, beyond the maximum x
  of every container/node. This guarantees it cannot overlap any boundary box. The
  `width`/`height`/`viewBox` of the root `<svg>` are updated to the expanded bounds
  (REQ-OUT-02); `RenderResult.width`/`height` (`00` §3.2) reflect the expanded size.
- The legend group is appended last in paint order (§3.3) so it is never occluded.

```typescript
/** One resolved legend entry: a role swatch + its display label. (internal) */
interface LegendEntry {
  /** The role this row documents. */
  role: NodeRole;
  /** Swatch fill (= palette.roles[role].fill). */
  fill: HexColor;
  /** Swatch stroke (= palette.roles[role].stroke). */
  stroke: HexColor;
  /** Title-cased display text (e.g. "Frontend"). */
  text: string;
}
```

### 3.5 Accessibility injection (REQ-A11Y-01)

Inject, on the root `<svg>` element:

- `role="img"` attribute.
- A `<title>` element as the **first** child, text = `spec.title`.
- A `<desc>` element as the **second** child, text = `spec.description`.
- Optionally `aria-labelledby` referencing the canonical ids assigned to the
  `<title>`/`<desc>` in §3.7 (e.g. `id="t-0" id="d-0"`), strengthening screen-reader
  association.

Text is XML-escaped. `<title>`/`<desc>` being the first two children also satisfies
the SVG accessibility convention (assistive tech reads the first `<title>`). This
pass is exactly what `02` §3's a11y assertion verifies; the assertion is the gate,
this pass is the producer.

### 3.6 Font embedding (REQ-OUT-04)

This pass is the linchpin of "opens identically in Inkscape/Office/PDF," not just
browsers. A bare `font-family` reference renders with whatever font the viewer
happens to have; a CDN `<link>` (the Cocoon anti-pattern, research §138) fails
offline. Instead the **subset font is embedded as a base64 data-URI**:

- Import the generated asset `FONT_SUBSET_DATA_URI` from
  `src/diagram/assets/font.subset.ts` (`01` §1 — a base64 `data:font/woff2;base64,…`
  string of a subset libre sans, e.g. a DejaVu Sans / IBM Plex subset). The asset is
  bundled into the CLI (`01` §2.1) so there is no filesystem or network read.
- Insert a `<style>` element inside a `<defs>` child of the root `<svg>` containing a
  single `@font-face`:

  ```css
  @font-face {
    font-family: "DiagramSans";
    font-style: normal;
    font-weight: 400;
    src: url(<FONT_SUBSET_DATA_URI>) format("woff2");
  }
  ```

- Rewrite **every** `font-family` reference in the document to `"DiagramSans"`. The
  render path already uses the placeholder `font-family="DiagramSans"` (`03` §4.2;
  Graphviz nodes get `fontname="DiagramSans"` in `dot-emit`), so this pass normalizes
  any stragglers and guarantees no other family leaks.

```typescript
import { FONT_SUBSET_DATA_URI } from "./assets/font.subset.js";

/** The single embedded face name; matches the render-path placeholder (03 §4.2). */
const EMBEDDED_FONT_FAMILY = "DiagramSans" as const;
```

This is what `02` §3's "embedded data-URI font present; no external font URL" and
REQ-SEC-02 ("fetch nothing at view time") assertions check.

### 3.7 Canonicalization pass (REQ-REPRO-01, resolves OTQ-6)

Graphviz-WASM output is not byte-stable (float layout, coordinate rounding,
generated-ID order, attribute order). With `@viz-js/viz` **pinned** (`01` §4) the
_geometry_ is reproducible across runs of the pinned engine, but the _serialization_
is not — so a deterministic serializer plus normalization makes the SVG
byte-identical. The pass is applied **last**, after all content passes, and produces
the string returned by `postProcess`. The exact rules:

1. **Deterministic element IDs.** Replace every `id` attribute (Graphviz emits
   `id="node1"`, `id="edge3"`, comment-derived ids, etc.) with sequential stable ids
   assigned by a **depth-first, document-order** walk: `e-0`, `e-1`, … for elements
   that need an id (those referenced by `aria-labelledby`/`xlink:href`/`url(#…)`),
   and **drop** ids that nothing references. Rewrite all intra-document references
   (`href="#…"`, `url(#…)`) to the new ids in the same walk. This removes the
   primary source of run-to-run drift.
2. **Fixed coordinate precision.** Round every numeric coordinate/length in
   geometry-bearing attributes (`d`, `points`, `x`, `y`, `cx`, `cy`, `width`,
   `height`, `transform` matrices, `viewBox`) to `SVG_COORD_PRECISION` decimals
   (`00` §6 — value `2`). Use a single fixed rounding function (round-half-to-even,
   then strip trailing zeros and a trailing `.`) so `1.2000001` and `1.2` both
   serialize to `1.2`. This neutralizes float jitter below the precision floor.
3. **Stable attribute ordering.** Serialize each element's attributes in a fixed
   order: a canonical priority list first (`id`, `class`, `role`, `transform`, `d`,
   `points`, `x`, `y`, `width`, `height`, `cx`, `cy`, `r`, `fill`, `stroke`,
   `stroke-width`, `stroke-dasharray`, `font-family`, `font-size`, `text-anchor`),
   then any remaining attributes in lexicographic order. Identical attribute sets
   always serialize identically.
4. **Stable element ordering.** Element _children_ are **not** reordered by this
   pass (paint order is semantic — §3.3 already fixed it); canonicalization only
   fixes _attribute_ order and id/coordinate normalization. The §3.3 z-order pass is
   the single authority on child order, and it is deterministic, so the combined
   result is stable.
5. **Whitespace normalization.** Emit with no insignificant whitespace between
   elements and a single fixed newline policy (one element per line or fully minified
   — choose **fully minified**, no inter-tag whitespace, to remove indentation as a
   drift source). Collapse runs of whitespace inside text nodes to single spaces and
   trim, except inside `<title>`/`<desc>` where the original text is preserved
   verbatim (and XML-escaped).
6. **Self-closing form.** Empty elements always serialize self-closed (`<rect …/>`),
   non-empty never; a single consistent rule.

```typescript
import { SVG_COORD_PRECISION } from "./schema.js";

/**
 * Round one numeric token to the fixed determinism precision (00 §6). Round-half-
 * to-even, then strip trailing zeros and any trailing decimal point so the textual
 * form is canonical: 1.20→"1.2", 1.00→"1", 0.005→"0".
 */
function canonNumber(n: number): string; // uses SVG_COORD_PRECISION
```

Applying these six rules to a tree whose geometry comes from the pinned engine
yields a **byte-identical** string across runs — the precondition for the
determinism assertion in `08`/`02` (REQ-REPRO-01, OTQ-6). LLM non-determinism in the
_prose_ path is out of scope (PRD §4.3 caveat): this guarantee holds for a fixed
`DiagramSpec`.

## 4. `src/diagram/png.ts` — SVG → PNG (REQ-OUT-03, resolves OTQ-5)

Rasterizes the **final** post-processed SVG to PNG **in-process**, with no system
binary and no network (tech-spec §3, REQ-OUT-03/04).

### 4.1 Engine choice & pin — WASM build (resolves OTQ-5)

There are two distributions:

- `@resvg/resvg-js` — a **native N-API addon** (a platform-specific `.node`
  binary). Fast, but the bundle (`01` §2.1, §5 note) cannot inline a native addon;
  it would resolve a `.node` at runtime, breaking the "fully self-contained, zero-
  install" claim on any platform whose prebuilt binary is absent.
- `@resvg/resvg-wasm` — the **WebAssembly build**. The `.wasm` can be inlined
  (base64) into the committed `diagram-render.mjs` exactly like `@viz-js/viz` is
  (`01` §2.1), so the bundle stays truly portable and zero-install.

**Decision (resolves OTQ-5 + the `01` §5 native-addon caveat): use the WASM build
`@resvg/resvg-wasm`.** REQ-OUT-04 demands an artifact pipeline with no install-time
platform dependency, and the WASM build is the only option that keeps the committed
bundle self-contained across all five target environments. The native addon's speed
edge is irrelevant at build-time diagram volumes. The `@viz-js/viz` precedent (WASM,
inlined) already proves the approach.

**Pin (no caret):** `@resvg/resvg-wasm@2.6.2` — pinned to an exact version so PNG
output drift is bounded and the dimension assertion (§4.3) is stable across CI runs.
(`2.6.2` is a concrete recent release; confirm it is the latest stable patch at
implementation time and pin whatever exact version is chosen — never a `^` range.)

> **WARNING:** `@resvg/resvg-wasm` is not yet installed in this repo (new bundled
> devDependency, `01` §4). The signatures below reflect its documented public API:
> `initWasm(input: Response | Promise<Response> | ArrayBuffer | Uint8Array | WebAssembly.Module): Promise<void>`
> and `new Resvg(svg: string | Uint8Array, opts?: ResvgRenderOptions)` with
> `.render(): RenderedImage` exposing `.asPng(): Uint8Array` and `.width`/`.height`.
> **Verify the exact `initWasm` input shape and `Resvg`/`ResvgRenderOptions` against
> the pinned package's `.d.ts` before implementing.** The contract this module owes
> the pipeline (`svg: string → Uint8Array PNG`, failures wrapped as
> `DiagramPngError`) does not change if the API differs.

### 4.2 Signature

```typescript
import { DiagramPngError } from "./errors.js";

/** Options for PNG rasterization. */
export interface RenderPngOptions {
  /**
   * Output scale multiplier applied to the SVG's intrinsic px dimensions
   * (1 = 1:1). Default `2` for crisp raster on high-DPI destinations. Resvg is
   * configured via `fitTo: { mode: "zoom", value: scale }`.
   */
  scale?: number;
}

/** Default raster scale (2× for high-DPI fallback PNGs). */
const DEFAULT_PNG_SCALE = 2 as const;

/**
 * Rasterize a final, post-processed tier-2 SVG to PNG bytes, fully in-process via
 * the inlined `@resvg/resvg-wasm` (REQ-OUT-03). The embedded data-URI font (§3.6)
 * means resvg needs no system fonts — text renders identically to the SVG.
 *
 * @param svg - The final SVG markup (post `postProcess`, §3). MUST carry explicit
 *   `width`/`height`/`viewBox` (REQ-OUT-02) so resvg sizes the raster correctly.
 * @param opts - Optional scale (default `DEFAULT_PNG_SCALE`).
 * @returns PNG file bytes as a `Uint8Array` (caller writes them; 05 §3).
 * @throws {DiagramPngError} (code `PNG_FAILED`, exit 5) if WASM init or rasterization
 *   fails — the underlying resvg message is wrapped into `detail`. No partial bytes.
 */
export async function renderPng(svg: string, opts?: RenderPngOptions): Promise<Uint8Array>;
```

WASM initialization is memoized (one `initWasm` per process, like `getViz` in
`03` §3.2): a module-level `let inited = false` guard so repeated `renderPng` calls
(e.g. `--format both` over several specs) init once.

### 4.3 Dimension assertion & tolerance

The PNG test is a **smoke test**, not a byte comparison (tech-spec §8 — resvg
version/platform variance). It asserts:

- The bytes are non-empty and begin with the PNG magic signature
  (`89 50 4E 47 0D 0A 1A 0A`).
- The decoded raster dimensions equal the SVG's intrinsic `width`/`height` × `scale`,
  within a tolerance of **±2px** per axis. The ±2px band absorbs resvg's sub-pixel
  rounding of fractional intrinsic sizes (after the §3.7 coordinate canonicalization,
  intrinsic sizes are already 2-dp, so drift is at most rounding of the scaled value).
  CI uses `Math.abs(actual - expected) <= 2`.

The exact-version pin (§4.1) is what makes even this loose assertion stable run to
run. PNG bytes are intentionally **not** committed as goldens.

### 4.4 Error handling

| Failure                                         | Wrapped as                                                       | Exit |
| ----------------------------------------------- | ---------------------------------------------------------------- | ---- |
| `initWasm` fails (corrupt/missing inlined WASM) | `DiagramPngError("PNG engine failed to initialize", <cause>)`    | 5    |
| `new Resvg(svg)` rejects malformed SVG          | `DiagramPngError("PNG rasterization rejected the SVG", <cause>)` | 5    |
| `.render()`/`.asPng()` throws                   | `DiagramPngError("PNG rasterization failed", <cause>)`           | 5    |

All map to `PNG_FAILED` (`00` §5, exit `5`). Because `renderPng` runs only after
output validation passes (`02` §3 / `render.ts`), a malformed-SVG rejection here is a
genuine resvg incompatibility, not user error — surfaced verbatim. No partial PNG is
ever written (the caller writes only on success, `05` §3).

## Dependencies

Must be implemented first:

- `00-core-definitions.md` — `NodeRole`, `Theme`, `HexColor`, `DiagramSpec`,
  `RenderResult`, `SVG_COORD_PRECISION`, `DiagramOutputError`, `DiagramPngError`
  (all referenced, none redefined here).
- `01-architecture-layout.md` — module placement (`src/diagram/theme.ts`,
  `svg-postprocess.ts`, `png.ts`, `assets/font.subset.ts`), the bundled-devDep model,
  and the native-addon bundling note (`01` §5) that §4.1 resolves.
- `03-rendering-engine.md` — produces the raw SVG `postProcess` consumes and defines
  the `class="role-<role>"` / `class="container"` / `font-family="DiagramSans"`
  markers (`03` §2.5, §4.1) and the no-legend/no-color/no-a11y contract this document
  completes.

External / asset dependencies:

- `@resvg/resvg-wasm@2.6.2` (pinned, bundled devDep) — §4.
- `@rgrove/parse-xml` (bundled devDep, `01` §4) — SVG DOM for the post-process passes.
- `src/diagram/assets/font.subset.ts` (`FONT_SUBSET_DATA_URI`) — embedded font (§3.6).

Consumed by:

- `render.ts` (`03` §5) runs the render path → `postProcess` (which resolves the
  palette internally via `resolveTheme`, so `render.ts` does **not** call
  `resolveTheme`) → output validation → optionally `renderPng`.
- `02-schema-and-validation.md` §3 asserts the properties these passes produce.

## Verification

- [ ] `resolveTheme(theme)` returns a `ResolvedPalette` whose `roles` map is **total**
      over every `NodeRole` value (no missing key) for both `"light"` and `"dark"`.
- [ ] Every role × {light,dark} `{fill,stroke,text}` is a valid `#rrggbb` hex.
- [ ] `resolveTheme("light", "#ff6600")` sets `palette.edge` and
      `roles.default.stroke` to `#ff6600` but leaves `roles.database.fill` at its
      semantic value (§2.3).
- [ ] After `postProcess`, every node shape carries an inline `fill`/`stroke` from
      the palette and every node `<text>` an inline `fill` (REQ-COV-01).
- [ ] The result contains `role="img"`, a `<title>` (= `spec.title`) and a `<desc>`
      (= `spec.description`) as the first two children of `<svg>` (REQ-A11Y-01).
- [ ] The result contains **no** `<foreignObject>` and contains `<text>` (tier-2,
      verified by `02` §3).
- [ ] The result contains exactly one embedded `@font-face` with a `data:` `src`
      and **no** external font URL; every `font-family` resolves to `"DiagramSans"`
      (REQ-OUT-04).
- [ ] When >1 distinct non-default role is present, a legend group exists and its
      bounding box lies entirely outside every container/node bounding box
      (REQ-COV-01); the `viewBox`/`width`/`height` are expanded to include it.
- [ ] Edge groups appear **before** node groups in the root child order (arrows
      behind boxes, §3.3, REQ-COV-01).
- [ ] Running the full pipeline twice on the same `DiagramSpec` with pinned
      `@viz-js/viz` yields **byte-identical** SVG (REQ-REPRO-01, §3.7).
- [ ] Canonicalized output has all coordinates at ≤ `SVG_COORD_PRECISION` decimals
      and attributes in the §3.7 fixed order.
- [ ] `renderPng(svg)` returns non-empty bytes starting with the PNG signature, with
      decoded dimensions = intrinsic × scale within ±2px (§4.3, REQ-OUT-03).
- [ ] A forced bad SVG into `renderPng` throws `DiagramPngError` (exit 5), never
      partial bytes.
- [ ] `@resvg/resvg-wasm` is pinned to an exact version (no `^`) in
      `devDependencies` and its `.wasm` is inlined into the committed bundle (§4.1).
