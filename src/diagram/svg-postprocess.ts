import { parseXml, XmlElement, XmlText } from "@rgrove/parse-xml";
import type { DiagramSpec, HexColor, NodeRole, Theme } from "./schema.js";
import { SVG_COORD_PRECISION } from "./schema.js";
import { resolveTheme, type ResolvedPalette } from "./theme.js";
import { DiagramOutputError } from "./errors.js";
import { FONT_SUBSET_DATA_URI } from "./assets/font.subset.js";

/**
 * `svg-postprocess.ts` — the finishing stage shared by BOTH render paths
 * (04-theme-postprocess-png.md §3). Given the raw, structure-only SVG from the
 * render path (graph-render or sequence-svg), a theme, and the validated
 * `DiagramSpec`, it runs the ordered passes — parse, semantic color baking,
 * z-order enforcement, legend placement, accessibility injection, font embedding,
 * and canonicalization — turning the raw SVG into the final tier-2-portable,
 * byte-deterministic artifact. Output validation (02 §3) runs afterward in
 * `render.ts`; this module produces, it does not assert.
 */

/** The single embedded face name; matches the render-path placeholder (03 §4.2). */
const EMBEDDED_FONT_FAMILY = "DiagramSans" as const;

// ---------------------------------------------------------------------------
// Options / result types (04 §3)
// ---------------------------------------------------------------------------

/** Options for one post-process call (one theme variant). */
export interface PostProcessOptions {
  /** The theme variant to bake (REQ-THEME-01); used to resolve the palette (§2). */
  theme: Theme;
  /** Optional validated accent override; falls back to the variant default (§2.3). */
  accent?: HexColor;
  /** The validated DiagramSpec; `title`/`description` feed a11y (§3.5), `nodes`/`containers` the legend (§3.4). */
  spec: DiagramSpec;
  /** Intrinsic width from the render path (sequence supplies it; graph passes 0 and it is derived from the SVG). */
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

// ---------------------------------------------------------------------------
// Lightweight mutable element tree (we re-serialize once, §3.7)
// ---------------------------------------------------------------------------

/** A serialization-ready element node. */
interface SElement {
  type: "element";
  name: string;
  attrs: Record<string, string>;
  children: SNode[];
  /** When true, text children are emitted raw (CSS in `<style>`), never escaped. */
  rawText?: boolean;
  /** When true, text children preserve original whitespace (`<title>`/`<desc>`). */
  preserveText?: boolean;
}

/** A serialization-ready text node. */
interface SText {
  type: "text";
  value: string;
}

type SNode = SElement | SText;

/**
 * Convert a parse-xml element subtree into our mutable {@link SNode} tree, dropping
 * comments / PIs / CDATA and any pre-existing `<title>`/`<desc>` (graphviz emits
 * per-node `<title>` metadata; §3.5 injects fresh ones).
 */
function toSNode(el: XmlElement): SElement {
  const children: SNode[] = [];
  for (const child of el.children) {
    if (child instanceof XmlElement) {
      if (child.name === "title" || child.name === "desc") continue;
      children.push(toSNode(child));
    } else if (child instanceof XmlText) {
      children.push({ type: "text", value: child.text });
    }
  }
  return { type: "element", name: el.name, attrs: { ...el.attributes }, children };
}

// ---------------------------------------------------------------------------
// Small tree helpers
// ---------------------------------------------------------------------------

/** All element children of `el`, in order. */
function elementChildren(el: SElement): SElement[] {
  return el.children.filter((c): c is SElement => c.type === "element");
}

/** Depth-first visit of every element in the subtree rooted at `el` (inclusive). */
function walk(el: SElement, fn: (e: SElement) => void): void {
  fn(el);
  for (const child of el.children) {
    if (child.type === "element") walk(child, fn);
  }
}

/** Extract the `role-<role>` token from a `class` attribute, if any. */
function roleFromClass(cls: string | undefined): NodeRole | undefined {
  if (cls === undefined) return undefined;
  const m = /(?:^|\s)role-([a-z]+)/.exec(cls);
  return m ? (m[1] as NodeRole) : undefined;
}

/** Whether `class` carries the given whitespace-delimited token. */
function hasClass(cls: string | undefined, token: string): boolean {
  if (cls === undefined) return false;
  return cls.split(/\s+/).includes(token);
}

// ---------------------------------------------------------------------------
// Entry point (04 §3)
// ---------------------------------------------------------------------------

/**
 * Transform the raw, structure-only SVG from the render path into the final
 * tier-2-portable SVG: semantic color baked inline, z-order enforced, legend
 * placed, `<title>`/`<desc>`/`role="img"` injected, the subset font embedded as a
 * data-URI, and the document canonicalized for determinism. The palette is
 * resolved internally via `resolveTheme` (§2) from `opts.theme`/`opts.accent`
 * (falling back to `opts.spec.accent`).
 *
 * @param rawSvg - A single `<svg>…</svg>` document with plain `<text>`, carrying
 *   `class="role-<role>"` on nodes and `class="container"` on clusters.
 * @param opts - `{ theme, accent?, spec, width, height }`.
 * @returns `{ svg, width, height, slug }` — the final SVG, its authoritative
 *   dimensions (after legend expansion + canonicalization), and the artifact slug.
 * @throws {DiagramOutputError} If the raw SVG cannot be parsed into a DOM.
 */
export function postProcess(rawSvg: string, opts: PostProcessOptions): PostProcessResult {
  const palette = resolveTheme(opts.theme, opts.accent ?? opts.spec.accent);

  // ── §3.1 Parse ──────────────────────────────────────────────────
  const root = parseRoot(rawSvg);

  // Current canvas bounds, derived from the SVG itself (graph path passes 0).
  const [minX, minY, initVbW, initVbH] = readViewBox(root, opts.width, opts.height);
  let vbW = initVbW;
  let vbH = initVbH;

  // The drawing parent: graphviz wraps everything in <g class="graph">; the
  // sequence path draws directly under <svg>. Color/z-order operate there.
  const drawParent = findDrawParent(root);

  // ── §3.2 Semantic color baking ──────────────────────────────────
  bakeColors(drawParent, palette);

  // ── §3.3 Z-order enforcement ────────────────────────────────────
  enforceZOrder(drawParent);

  // ── §3.4 Legend placement (may expand the canvas) ───────────────
  const legend = buildLegend(opts.spec, palette);
  if (legend.length > 0) {
    const expanded = placeLegend(root, legend, palette, minX, minY, vbW, vbH);
    vbW = expanded.vbW;
    vbH = expanded.vbH;
  }

  // ── §3.5 Accessibility injection ────────────────────────────────
  injectA11y(root, opts.spec);

  // ── §3.6 Font embedding ─────────────────────────────────────────
  embedFont(root);

  // ── Backdrop rect (full viewBox), behind all drawing content ────
  insertBackdrop(root, palette, minX, minY, vbW, vbH);

  // Authoritative dimensions on the root (numeric, no `pt`).
  root.attrs["width"] = canonNumber(vbW);
  root.attrs["height"] = canonNumber(vbH);
  root.attrs["viewBox"] =
    `${canonNumber(minX)} ${canonNumber(minY)} ${canonNumber(vbW)} ${canonNumber(vbH)}`;

  // ── §3.7 Canonicalization (last) ────────────────────────────────
  canonicalizeIds(root);
  const svg = serialize(root);

  return {
    svg,
    width: round(vbW),
    height: round(vbH),
    slug: slugify(opts.spec.title),
  };
}

// ---------------------------------------------------------------------------
// §3.1 Parse
// ---------------------------------------------------------------------------

/** Parse `rawSvg`, returning the root `<svg>` as a mutable {@link SElement}. */
function parseRoot(rawSvg: string): SElement {
  let docRoot: XmlElement | null;
  try {
    docRoot = parseXml(rawSvg).root;
  } catch (err) {
    throw new DiagramOutputError(
      "raw SVG is not well-formed XML",
      err instanceof Error ? err.message : String(err),
    );
  }
  if (!docRoot || docRoot.name !== "svg") {
    throw new DiagramOutputError(
      "raw SVG root element is not <svg>",
      docRoot ? docRoot.name : "(no root)",
    );
  }
  return toSNode(docRoot);
}

/**
 * Read the four `viewBox` numbers, falling back to width/height (graph path passes
 * 0 for both, so the SVG's own `viewBox` is authoritative there).
 */
function readViewBox(
  root: SElement,
  fallbackW: number,
  fallbackH: number,
): [number, number, number, number] {
  const vb = root.attrs["viewBox"];
  if (vb) {
    const parts = vb.trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
    }
  }
  return [0, 0, fallbackW, fallbackH];
}

/** Find the drawing parent: the first `<g class="graph">`, else the root itself. */
function findDrawParent(root: SElement): SElement {
  for (const child of elementChildren(root)) {
    if (child.name === "g" && hasClass(child.attrs["class"], "graph")) {
      return child;
    }
  }
  return root;
}

// ---------------------------------------------------------------------------
// §3.2 Semantic color baking (REQ-COV-01)
// ---------------------------------------------------------------------------

const SHAPE_NAMES = new Set(["polygon", "ellipse", "path", "rect", "circle"]);

/** Apply role/edge/container/backdrop colors inline to the drawing subtree. */
function bakeColors(drawParent: SElement, palette: ResolvedPalette): void {
  // Recolor any graphviz backdrop polygon (direct fill="white" child) to background.
  for (const child of elementChildren(drawParent)) {
    if ((child.name === "polygon" || child.name === "rect") && child.attrs["fill"] === "white") {
      child.attrs["fill"] = palette.background;
    }
  }

  for (const group of elementChildren(drawParent)) {
    const cls = group.attrs["class"];
    const role = roleFromClass(cls);
    if (role !== undefined) {
      const colors = palette.roles[role] ?? palette.roles.default;
      walk(group, (e) => {
        if (SHAPE_NAMES.has(e.name)) {
          // Preserve an explicit fill="none" (e.g. sequence header outline box).
          if (e.attrs["fill"] !== "none") e.attrs["fill"] = colors.fill;
          e.attrs["stroke"] = colors.stroke;
        } else if (e.name === "text") {
          e.attrs["fill"] = colors.text;
        }
      });
    } else if (hasClass(cls, "container") || hasClass(cls, "cluster")) {
      walk(group, (e) => {
        if (SHAPE_NAMES.has(e.name)) {
          e.attrs["fill"] = "none";
          e.attrs["stroke"] = palette.boundary;
          e.attrs["stroke-dasharray"] = "6 4";
        } else if (e.name === "text") {
          e.attrs["fill"] = palette.label;
        }
      });
    } else if (hasClass(cls, "edge")) {
      walk(group, (e) => {
        if (e.name === "path") {
          e.attrs["stroke"] = palette.edge;
        } else if (e.name === "polygon" || e.name === "polyline") {
          e.attrs["fill"] = palette.edge;
          e.attrs["stroke"] = palette.edge;
        } else if (e.name === "text") {
          e.attrs["fill"] = palette.label;
        }
      });
    }
  }

  // Sequence-path primitives that live directly under the draw parent (lifelines,
  // activations, message arrows) are colored from base tokens.
  for (const child of elementChildren(drawParent)) {
    colorSequencePrimitive(child, palette);
  }
}

/** Color a bare sequence primitive (line/polyline/polygon/text) by its class. */
function colorSequencePrimitive(el: SElement, palette: ResolvedPalette): void {
  const cls = el.attrs["class"];
  if (cls === undefined) return;
  if (hasClass(cls, "lifeline")) {
    el.attrs["stroke"] = palette.boundary;
  } else if (hasClass(cls, "activation")) {
    el.attrs["fill"] = palette.surface;
    el.attrs["stroke"] = palette.edge;
  } else if (cls.includes("message") || cls.includes("arrowhead")) {
    el.attrs["stroke"] = palette.edge;
    if (el.name === "polygon" || (el.attrs["fill"] && el.attrs["fill"] !== "none")) {
      if (el.attrs["fill"] !== "none") el.attrs["fill"] = palette.edge;
    }
  } else if (cls.includes("message-label") && el.name === "text") {
    el.attrs["fill"] = palette.label;
  }
  if (el.name === "text" && cls.includes("label")) {
    el.attrs["fill"] = palette.label;
  }
}

// ---------------------------------------------------------------------------
// §3.3 Z-order enforcement (REQ-COV-01)
// ---------------------------------------------------------------------------

/**
 * Re-order the drawing parent's element children into the fixed paint order
 * (back → front): other(backdrop) → containers → edges → nodes. Non-element
 * children (whitespace text) are dropped. Original order is preserved within each
 * band, so the pass is deterministic.
 */
function enforceZOrder(drawParent: SElement): void {
  const bands: Record<string, SElement[]> = {
    other: [],
    container: [],
    edge: [],
    node: [],
  };
  for (const child of elementChildren(drawParent)) {
    const cls = child.attrs["class"];
    if (roleFromClass(cls) !== undefined) bands.node!.push(child);
    else if (hasClass(cls, "container") || hasClass(cls, "cluster")) bands.container!.push(child);
    else if (hasClass(cls, "edge")) bands.edge!.push(child);
    else bands.other!.push(child);
  }
  drawParent.children = [...bands.other!, ...bands.container!, ...bands.edge!, ...bands.node!];
}

// ---------------------------------------------------------------------------
// §3.4 Legend placement (REQ-COV-01)
// ---------------------------------------------------------------------------

/** One resolved legend entry: a role swatch + its display label. */
interface LegendEntry {
  role: NodeRole;
  fill: HexColor;
  stroke: HexColor;
  text: string;
}

// Legend geometry constants (user-space px). Fixed → deterministic.
const LG_SWATCH = 14;
const LG_ROW_H = 22;
const LG_GUTTER = 24;
const LG_PAD = 12;
const LG_TEXT_GAP = 8;
const LG_CHAR_W = 7.5;

/** Compute the distinct non-default roles present, in canonical role order. */
function buildLegend(spec: DiagramSpec, palette: ResolvedPalette): LegendEntry[] {
  const present = new Set<NodeRole>();
  for (const n of spec.nodes) if (n.role && n.role !== "default") present.add(n.role);
  for (const p of spec.participants) if (p.role && p.role !== "default") present.add(p.role);

  // Canonical, deterministic ordering = the palette's role key order.
  const order = Object.keys(palette.roles) as NodeRole[];
  const entries: LegendEntry[] = [];
  for (const role of order) {
    if (!present.has(role)) continue;
    const colors = palette.roles[role];
    entries.push({
      role,
      fill: colors.fill,
      stroke: colors.stroke,
      text: titleCase(role),
    });
  }
  return entries;
}

/**
 * Append a legend group placed in an expanded right-hand margin (outside every
 * boundary box, REQ-COV-01) and return the expanded canvas dimensions.
 */
function placeLegend(
  root: SElement,
  entries: LegendEntry[],
  palette: ResolvedPalette,
  minX: number,
  minY: number,
  vbW: number,
  vbH: number,
): { vbW: number; vbH: number } {
  const maxLabel = Math.max(...entries.map((e) => e.text.length));
  const colWidth = Math.ceil(LG_PAD * 2 + LG_SWATCH + LG_TEXT_GAP + maxLabel * LG_CHAR_W);
  const legendX = minX + vbW + LG_GUTTER;
  const newVbW = vbW + LG_GUTTER + colWidth;
  const neededH = LG_PAD * 2 + entries.length * LG_ROW_H;
  const newVbH = Math.max(vbH, neededH);

  const group: SElement = {
    type: "element",
    name: "g",
    attrs: { class: "legend" },
    children: [],
  };
  // Legend panel surface.
  group.children.push({
    type: "element",
    name: "rect",
    attrs: {
      class: "legend-box",
      x: canonNumber(legendX),
      y: canonNumber(minY + LG_PAD / 2),
      width: canonNumber(colWidth),
      height: canonNumber(neededH - LG_PAD),
      fill: palette.surface,
      stroke: palette.boundary,
    },
    children: [],
  });
  entries.forEach((entry, i) => {
    const rowY = minY + LG_PAD + i * LG_ROW_H;
    group.children.push({
      type: "element",
      name: "rect",
      attrs: {
        x: canonNumber(legendX + LG_PAD),
        y: canonNumber(rowY),
        width: canonNumber(LG_SWATCH),
        height: canonNumber(LG_SWATCH),
        fill: entry.fill,
        stroke: entry.stroke,
      },
      children: [],
    });
    group.children.push({
      type: "element",
      name: "text",
      attrs: {
        x: canonNumber(legendX + LG_PAD + LG_SWATCH + LG_TEXT_GAP),
        y: canonNumber(rowY + LG_SWATCH - 2),
        fill: palette.label,
        "font-family": EMBEDDED_FONT_FAMILY,
        "font-size": "13",
      },
      children: [{ type: "text", value: entry.text }],
    });
  });

  // Legend paints last (never occluded, §3.3/§3.4).
  root.children.push(group);
  return { vbW: newVbW, vbH: newVbH };
}

// ---------------------------------------------------------------------------
// §3.5 Accessibility injection (REQ-A11Y-01)
// ---------------------------------------------------------------------------

/** Inject `role="img"`, a `<title>` and a `<desc>` as the first two children. */
function injectA11y(root: SElement, spec: DiagramSpec): void {
  root.attrs["role"] = "img";
  root.attrs["aria-labelledby"] = "diagram-title diagram-desc";

  const title: SElement = {
    type: "element",
    name: "title",
    attrs: { id: "diagram-title" },
    children: [{ type: "text", value: spec.title }],
    preserveText: true,
  };
  const desc: SElement = {
    type: "element",
    name: "desc",
    attrs: { id: "diagram-desc" },
    children: [{ type: "text", value: spec.description }],
    preserveText: true,
  };
  root.children.unshift(title, desc);
}

// ---------------------------------------------------------------------------
// §3.6 Font embedding (REQ-OUT-04)
// ---------------------------------------------------------------------------

/** Embed the subset font as a data-URI `@font-face` and normalize `font-family`. */
function embedFont(root: SElement): void {
  const css =
    `@font-face{font-family:"${EMBEDDED_FONT_FAMILY}";font-style:normal;` +
    `font-weight:400;src:url(${FONT_SUBSET_DATA_URI}) format("woff2");}`;
  const style: SElement = {
    type: "element",
    name: "style",
    attrs: { type: "text/css" },
    children: [{ type: "text", value: css }],
    rawText: true,
  };
  const defs: SElement = {
    type: "element",
    name: "defs",
    attrs: {},
    children: [style],
  };
  // Defs is inserted after the a11y nodes so <title>/<desc> stay first/second.
  root.children.splice(2, 0, defs);

  // Rewrite every font-family reference to the single embedded face.
  walk(root, (e) => {
    if (e.attrs["font-family"] !== undefined) {
      e.attrs["font-family"] = EMBEDDED_FONT_FAMILY;
    }
  });
}

// ---------------------------------------------------------------------------
// Backdrop rect
// ---------------------------------------------------------------------------

/** Insert a full-viewBox backdrop rect as the first drawing element. */
function insertBackdrop(
  root: SElement,
  palette: ResolvedPalette,
  minX: number,
  minY: number,
  vbW: number,
  vbH: number,
): void {
  const backdrop: SElement = {
    type: "element",
    name: "rect",
    attrs: {
      class: "backdrop",
      x: canonNumber(minX),
      y: canonNumber(minY),
      width: canonNumber(vbW),
      height: canonNumber(vbH),
      fill: palette.background,
    },
    children: [],
  };
  // After [title, desc, defs]; before the drawing content (§3.2 first-drawing).
  root.children.splice(3, 0, backdrop);
}

// ---------------------------------------------------------------------------
// §3.7 Canonicalization
// ---------------------------------------------------------------------------

/**
 * Reassign element ids deterministically: keep only ids that something references
 * (via `aria-labelledby`, `href`/`xlink:href="#…"`, or `url(#…)`), renumber them
 * `e-0,e-1,…` in document order, and drop all unreferenced ids.
 */
function canonicalizeIds(root: SElement): void {
  const referenced = new Set<string>();
  walk(root, (e) => {
    for (const [name, value] of Object.entries(e.attrs)) {
      if (name === "aria-labelledby" || name === "aria-describedby") {
        for (const tok of value.split(/\s+/)) if (tok) referenced.add(tok);
      } else if (name === "href" || name === "xlink:href") {
        if (value.startsWith("#")) referenced.add(value.slice(1));
      }
      for (const m of value.matchAll(/url\(#([^)]+)\)/g)) referenced.add(m[1]!);
    }
  });

  const remap = new Map<string, string>();
  let counter = 0;
  walk(root, (e) => {
    const id = e.attrs["id"];
    if (id === undefined) return;
    if (referenced.has(id)) {
      const next = `e-${counter++}`;
      remap.set(id, next);
      e.attrs["id"] = next;
    } else {
      delete e.attrs["id"];
    }
  });

  // Rewrite all references to the remapped ids.
  walk(root, (e) => {
    for (const [name, value] of Object.entries(e.attrs)) {
      if (name === "aria-labelledby" || name === "aria-describedby") {
        e.attrs[name] = value
          .split(/\s+/)
          .map((t) => remap.get(t) ?? t)
          .join(" ");
      } else if ((name === "href" || name === "xlink:href") && value.startsWith("#")) {
        const target = remap.get(value.slice(1));
        if (target) e.attrs[name] = `#${target}`;
      } else if (value.includes("url(#")) {
        e.attrs[name] = value.replace(/url\(#([^)]+)\)/g, (full, id: string) =>
          remap.has(id) ? `url(#${remap.get(id)})` : full,
        );
      }
    }
  });
}

/** Round-half-to-even to `SVG_COORD_PRECISION` decimals. */
function round(n: number): number {
  const f = 10 ** SVG_COORD_PRECISION;
  const x = n * f;
  const floor = Math.floor(x);
  const diff = x - floor;
  let r: number;
  if (diff > 0.5) r = floor + 1;
  else if (diff < 0.5) r = floor;
  else r = floor % 2 === 0 ? floor : floor + 1; // half-to-even
  return r / f;
}

/**
 * Canonical textual form of a number: round to precision, strip trailing zeros and
 * any trailing decimal point. `1.20→"1.2"`, `1.00→"1"`, `-0→"0"`.
 */
function canonNumber(n: number): string {
  const r = round(n);
  let s = r.toFixed(SVG_COORD_PRECISION);
  s = s.replace(/\.?0+$/, "");
  if (s === "" || s === "-0") s = "0";
  return s;
}

/**
 * Round every numeric token inside a string value (for `points`/`d`/`transform`).
 *
 * NOTE: this rounds ALL numeric tokens positionally and assumes the `d` attribute
 * contains NO elliptical-arc commands (`A`/`a`). In an arc command the large-arc-flag
 * and sweep-flag are single, position-significant digits that may appear without
 * separators (e.g. `a5 5 0 0014 0`); re-tokenizing/rounding them would corrupt the
 * path. This is safe here because the only `d` producer is Graphviz (`dot-emit.ts` →
 * `graph-render.ts`), whose output for the in-scope shapes (box/ellipse/diamond/
 * cylinder/polygon edges) never emits `A`/`a` arcs. If a future render path can emit
 * arcs, exclude `d` from GEOMETRY_ATTRS and round path coordinates at emission time.
 */
function canonNumberTokens(value: string): string {
  return value.replace(/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g, (tok) => canonNumber(Number(tok)));
}

/** Geometry-bearing attributes whose numeric tokens are rounded (§3.7 rule 2). */
const GEOMETRY_ATTRS = new Set([
  "d",
  "points",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "transform",
  "viewBox",
  "stroke-width",
]);

/** Canonical attribute priority order (§3.7 rule 3). */
const ATTR_PRIORITY = [
  "id",
  "class",
  "role",
  "transform",
  "d",
  "points",
  "x",
  "y",
  "width",
  "height",
  "cx",
  "cy",
  "r",
  "fill",
  "stroke",
  "stroke-width",
  "stroke-dasharray",
  "font-family",
  "font-size",
  "text-anchor",
];

// ---------------------------------------------------------------------------
// Serialization (single pass, §3.7 — minified, byte-deterministic)
// ---------------------------------------------------------------------------

/** Escape an XML attribute value. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Escape XML text content (`&`, `<`, `>`). */
function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Serialize one element's attributes in canonical order with rounded geometry. */
function serializeAttrs(el: SElement): string {
  const names = Object.keys(el.attrs);
  names.sort((a, b) => {
    const ia = ATTR_PRIORITY.indexOf(a);
    const ib = ATTR_PRIORITY.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  let out = "";
  for (const name of names) {
    let value = el.attrs[name]!;
    if (GEOMETRY_ATTRS.has(name)) value = canonNumberTokens(value);
    out += ` ${name}="${escapeAttr(value)}"`;
  }
  return out;
}

/** Serialize the tree to a fully-minified, byte-deterministic SVG string. */
function serialize(root: SElement): string {
  const out: string[] = [];
  const emit = (node: SNode, raw: boolean, preserve: boolean): void => {
    if (node.type === "text") {
      if (raw) {
        out.push(node.value);
      } else if (preserve) {
        out.push(escapeText(node.value));
      } else {
        const collapsed = node.value.replace(/\s+/g, " ").trim();
        if (collapsed) out.push(escapeText(collapsed));
      }
      return;
    }
    const attrs = serializeAttrs(node);
    const realChildren = node.children.filter(
      (c) => c.type === "element" || (c.type === "text" && c.value.trim() !== ""),
    );
    if (realChildren.length === 0) {
      out.push(`<${node.name}${attrs}/>`);
      return;
    }
    out.push(`<${node.name}${attrs}>`);
    for (const child of node.children) {
      emit(child, node.rawText === true, node.preserveText === true);
    }
    out.push(`</${node.name}>`);
  };
  emit(root, false, false);
  return out.join("");
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

/** Title-case a lowercase role token (e.g. `"frontend"` → `"Frontend"`). */
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Derive a filename slug from a title: lowercase, non-alphanumerics → `-`,
 * collapse/trim dashes. Falls back to `"diagram"` for an empty result.
 */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "diagram";
}
