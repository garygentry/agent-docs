import { z } from "zod";
import { parseXml, XmlElement, type XmlDocument } from "@rgrove/parse-xml";
import {
  DiagramSpec,
  type DiagramSpec as DiagramSpecT,
  type DiagramType,
  type FillStyle,
} from "./schema.js";
import { DiagramInputError, DiagramOutputError } from "./errors.js";

/**
 * Cross-field input validation and post-render output assertions for the
 * diagram-generator skill (02-schema-and-validation.md §2–3). Stage 1
 * ({@link parseSpec}) turns untrusted JSON into a fully validated `DiagramSpec`;
 * Stage 2 ({@link assertOutputValid}) proves the rendered SVG is tier-2 portable,
 * structurally complete, font-portable, and accessible before any byte is written.
 * Both fail loudly with the typed errors from `errors.ts` (REQ-REL-01/02).
 */

// ===========================================================================
// 2. Cross-field input validation — diagramSuperRefine (REQ-IN-02, REQ-REL-01/02)
// ===========================================================================

/**
 * The decoded shape `diagramSuperRefine` operates on: the result of the base
 * `DiagramSpec` object schema (00 §2.4) AFTER per-field validation and defaulting,
 * but BEFORE cross-field checks. Defaults (`nodes: []`, `theme: "light"`, etc.)
 * are already applied, so every array is present (never `undefined`).
 */
interface DecodedSpec {
  diagramType: DiagramType;
  nodes: Array<{ id: string }>;
  edges: Array<{ from: string; to: string }>;
  containers: Array<{ id: string; children: string[]; parent?: string }>;
  participants: Array<{ id: string }>;
  messages: Array<{ from: string; to: string }>;
}

/**
 * The set of `diagramType` values that use the graph model (`nodes`/`edges`/
 * `containers`) rather than the sequence model. Mirrors the 00 §2.5 table; the
 * sole complement is `"sequence"`. Exported so tests assert the partition.
 */
export const GRAPH_DIAGRAM_TYPES: ReadonlySet<DiagramType> = new Set([
  "architecture",
  "flowchart",
  "er",
  "state",
  "dataflow",
]);

/**
 * Cross-field validation for `DiagramSpec` (00 §3.1), applied as a `superRefine`
 * by {@link parseSpec}. Enforces, in order:
 *
 *   1. Unique ids within `nodes`, within `containers`, and within `participants`.
 *   2. Node/container namespace non-collision (no id is both a node and a container)
 *      — because `Edge`/`Container.children`/`Container.parent` resolve across that
 *      shared namespace (00 §2.2).
 *   3. Referential integrity: every `Edge.from`/`Edge.to` and `Container.children[]`
 *      resolves to an existing node id; every `Container.parent` resolves to an
 *      existing container id; every `Message.from`/`Message.to` resolves to an
 *      existing participant id.
 *   4. Diagram-type ↔ field agreement (00 §2.5): graph types MUST have non-empty
 *      `nodes` and empty `participants`/`messages`; `sequence` MUST have non-empty
 *      `participants` and empty `nodes`/`edges`/`containers`.
 *
 * Each violation is reported via `ctx.addIssue` with a precise `path` (the offending
 * JSON path, e.g. `["edges", 3, "to"]`). Zod aggregates these; {@link parseSpec}
 * wraps the resulting `ZodError` into a `DiagramInputError` (§2.4) carrying the
 * joined paths. This function NEVER throws — it only records issues — so all
 * violations surface in one pass (REQ-REL-02: report fully, fail once).
 *
 * @param spec - The per-field-valid, defaulted DiagramSpec object.
 * @param ctx - Zod refinement context; issues are added here.
 */
export function diagramSuperRefine(spec: DecodedSpec, ctx: z.RefinementCtx): void {
  // ── 1. Unique ids (per collection) ──────────────────────────────
  reportDuplicates(spec.nodes, "nodes", ctx);
  reportDuplicates(spec.containers, "containers", ctx);
  reportDuplicates(spec.participants, "participants", ctx);

  // ── 2. Node/container namespace non-collision ───────────────────
  const nodeIds = new Set(spec.nodes.map((n) => n.id));
  const containerIds = new Set(spec.containers.map((c) => c.id));
  for (const [i, c] of spec.containers.entries()) {
    if (nodeIds.has(c.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["containers", i, "id"],
        message: `container id "${c.id}" collides with a node id; the node and container id namespaces must not overlap`,
      });
    }
  }

  // ── 3. Referential integrity ────────────────────────────────────
  const participantIds = new Set(spec.participants.map((p) => p.id));

  for (const [i, e] of spec.edges.entries()) {
    if (!nodeIds.has(e.from)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["edges", i, "from"],
        message: `edge.from "${e.from}" references a node that does not exist`,
      });
    }
    if (!nodeIds.has(e.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["edges", i, "to"],
        message: `edge.to "${e.to}" references a node that does not exist`,
      });
    }
  }

  for (const [i, c] of spec.containers.entries()) {
    for (const [j, childId] of c.children.entries()) {
      if (!nodeIds.has(childId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["containers", i, "children", j],
          message: `container child "${childId}" references a node that does not exist`,
        });
      }
    }
    if (c.parent !== undefined && !containerIds.has(c.parent)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["containers", i, "parent"],
        message: `container.parent "${c.parent}" references a container that does not exist`,
      });
    }
  }

  for (const [i, m] of spec.messages.entries()) {
    if (!participantIds.has(m.from)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["messages", i, "from"],
        message: `message.from "${m.from}" references a participant that does not exist`,
      });
    }
    if (!participantIds.has(m.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["messages", i, "to"],
        message: `message.to "${m.to}" references a participant that does not exist`,
      });
    }
  }

  // ── 4. Diagram-type ↔ field agreement (00 §2.5) ─────────────────
  if (GRAPH_DIAGRAM_TYPES.has(spec.diagramType)) {
    if (spec.nodes.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["nodes"],
        message: `diagramType "${spec.diagramType}" requires at least one node`,
      });
    }
    rejectNonEmpty(spec.participants, "participants", spec.diagramType, ctx);
    rejectNonEmpty(spec.messages, "messages", spec.diagramType, ctx);
  } else {
    // diagramType === "sequence"
    if (spec.participants.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["participants"],
        message: `diagramType "sequence" requires at least one participant`,
      });
    }
    rejectNonEmpty(spec.nodes, "nodes", spec.diagramType, ctx);
    rejectNonEmpty(spec.edges, "edges", spec.diagramType, ctx);
    rejectNonEmpty(spec.containers, "containers", spec.diagramType, ctx);
  }
}

/**
 * Record a `custom` issue for every duplicate id in `items`, pathed at the second
 * (and later) occurrence so the offending entry is pinpointed. Helper for rule 1.
 */
function reportDuplicates(items: Array<{ id: string }>, field: string, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const [i, item] of items.entries()) {
    if (seen.has(item.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field, i, "id"],
        message: `duplicate ${field} id "${item.id}"`,
      });
    }
    seen.add(item.id);
  }
}

/**
 * Record an issue if `items` is non-empty, used by rule 4 to reject fields that
 * must be empty for the given `diagramType` (00 §2.5).
 */
function rejectNonEmpty(
  items: unknown[],
  field: string,
  diagramType: DiagramType,
  ctx: z.RefinementCtx,
): void {
  if (items.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [field],
      message: `diagramType "${diagramType}" must not populate "${field}" (00 §2.5)`,
    });
  }
}

/**
 * The base `DiagramSpec` object (00 §2.4) with the cross-field {@link diagramSuperRefine}
 * layered on. `schema.ts` keeps the base schema free of the refine (so the inferred
 * type stays a plain object); `parseSpec` applies the refine here, the single place
 * cross-field validation runs.
 */
const RefinedDiagramSpec = DiagramSpec.superRefine(diagramSuperRefine);

// ---------------------------------------------------------------------------
// 2.4 Parse entry point — parseSpec (REQ-REL-02)
// ---------------------------------------------------------------------------

/**
 * Parse and fully validate untrusted JSON into a `DiagramSpec` (00 §2.4 + §2/§2.5
 * cross-field rules). On ANY validation failure — per-field, `.strict()` unknown
 * key, or cross-field — throws a single `DiagramInputError` (00 §5) whose `detail`
 * is the newline-joined list of `path: message` issues. This is Stage 1 of the
 * two-stage contract (tech-spec §3.5): on failure, NOTHING is rendered or written.
 *
 * @param raw - Already-JSON-parsed input (the CLI parses the JSON text first; a
 *              JSON syntax error is surfaced separately as a usage/IO error in
 *              05-cli-and-invocation.md §3).
 * @returns The validated, defaulted DiagramSpec.
 * @throws {DiagramInputError} If validation fails (code INPUT_INVALID, exit 2).
 */
export function parseSpec(raw: unknown): DiagramSpecT {
  const result = RefinedDiagramSpec.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`)
      .join("\n");
    throw new DiagramInputError("diagram input failed validation", detail);
  }
  return result.data;
}

// ===========================================================================
// 3. Output assertions (REQ-REL-01/02, REQ-OUT-02/04, REQ-A11Y-01)
// ===========================================================================

/**
 * Stage 2 of the two-stage validation contract (tech-spec §3.5). Runs every output
 * assertion against the rendered SVG, in a fixed order so the FIRST violation
 * reported is the most fundamental (well-formedness before structure before
 * portability before a11y). Returns normally iff the SVG satisfies every property;
 * otherwise throws the first `DiagramOutputError`.
 *
 * MUST be called by `render.ts` before the SVG (or its PNG rasterization) is written
 * to disk — a failure here means NO artifact is emitted (REQ-REL-01/02).
 *
 * @param svg - The post-processed SVG markup produced by the render pipeline.
 * @param fillStyle - The resolved shape-fill style. When `"transparent"`, role
 *        nodes are INTENTIONALLY outline-only, so the {@link assertRoleFills}
 *        guard (#13) is skipped; for `translucent`/`solid` (or when omitted) it
 *        still runs to catch the accidental outline-only regression.
 * @param embedFont - Whether the subset font was embedded (default true). When
 *        false (`--embed-font=false`), the SVG intentionally references a system
 *        font stack, so the {@link assertFontPortable} embedded-face guard
 *        (REQ-OUT-04) is skipped — though the external-URL/`@import` ban still runs.
 * @throws {DiagramOutputError} On the first failed assertion (code OUTPUT_INVALID,
 *         exit 4); `detail` names the assertion that failed.
 */
export function assertOutputValid(
  svg: string,
  fillStyle?: FillStyle,
  embedFont: boolean = true,
): void {
  const doc = assertWellFormed(svg); // parse once, reuse the tree
  assertTier2(svg);
  assertStructural(svg, doc);
  assertFontPortable(svg, embedFont);
  assertA11y(doc);
  if (fillStyle !== "transparent") assertRoleFills(doc);
}

/** Shape element names whose `fill` carries a node's role color (mirrors §3.2). */
const ROLE_SHAPE_NAMES = new Set(["polygon", "ellipse", "path", "rect", "circle"]);

/**
 * Assert every role-classed node group renders as a solid fill, not an outline
 * (#13). Graphviz emits node shapes with `fill="none"`; the post-process MUST bake
 * `colors.fill` onto them. This guard would have caught the outline-only-nodes
 * regression: it walks each `class~="role-*"` group and fails if all of its shape
 * descendants are unfilled (`fill="none"` or absent).
 *
 * @param doc - The parsed output SVG document.
 * @throws {DiagramOutputError} If any role group has shapes but none is filled.
 */
export function assertRoleFills(doc: XmlDocument): void {
  const root = doc.root;
  if (!root) return;
  const groups: XmlElement[] = [];
  const collect = (el: XmlElement): void => {
    const cls = el.attributes["class"];
    if (cls && /(?:^|\s)role-[a-z]+/.test(cls)) groups.push(el);
    for (const child of el.children) if (child instanceof XmlElement) collect(child);
  };
  collect(root);

  for (const group of groups) {
    let sawShape = false;
    let sawFilled = false;
    const visit = (el: XmlElement): void => {
      if (ROLE_SHAPE_NAMES.has(el.name)) {
        sawShape = true;
        const fill = el.attributes["fill"];
        if (fill !== undefined && fill !== "none") sawFilled = true;
      }
      for (const child of el.children) if (child instanceof XmlElement) visit(child);
    };
    visit(group);
    if (sawShape && !sawFilled) {
      throw new DiagramOutputError(
        "a role-classed node renders outline-only; node shapes must carry a non-none fill (#13)",
        `class="${group.attributes["class"]}"`,
      );
    }
  }
}

/**
 * Assert the SVG string is well-formed XML by parsing it with `@rgrove/parse-xml`.
 * Returns the parsed document for reuse by later assertions (§3.4, §3.6). A parse
 * failure (unclosed tag, bad entity, illegal char) is the most fundamental output
 * defect and is reported first (REQ-REL-01).
 *
 * @param svg - The SVG markup to validate.
 * @returns The parsed XML document.
 * @throws {DiagramOutputError} If the markup is not well-formed XML.
 */
export function assertWellFormed(svg: string): XmlDocument {
  try {
    return parseXml(svg);
  } catch (err) {
    throw new DiagramOutputError(
      "rendered SVG is not well-formed XML",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Assert the SVG is "tier-2 clean" (REQ-OUT-01): it MUST contain at least one
 * `<text>` element (so labels are real SVG text, not raster or HTML) and MUST NOT
 * contain any `<foreignObject>` (the HTML-embedding escape hatch that breaks in
 * Inkscape/Office/PDF). String-level checks are sufficient and cheap; the markup is
 * already known well-formed (§3.2 ran first), so a literal `<text` / `<foreignObject`
 * substring is a reliable signal.
 *
 * @param svg - The SVG markup to validate.
 * @throws {DiagramOutputError} If no `<text>` is present, or any `<foreignObject>`
 *         is present.
 */
export function assertTier2(svg: string): void {
  if (svg.includes("<foreignObject")) {
    throw new DiagramOutputError(
      "rendered SVG contains <foreignObject>, which is not tier-2 portable (REQ-OUT-01)",
      "assertTier2",
    );
  }
  if (!/<text[\s>]/.test(svg)) {
    throw new DiagramOutputError(
      "rendered SVG contains no <text> element; labels must be plain SVG text (REQ-OUT-01)",
      "assertTier2",
    );
  }
}

/**
 * Assert the root `<svg>` declares an explicit `viewBox` AND `width` AND `height`,
 * and that the `viewBox` is four well-formed numeric values (REQ-OUT-02:
 * "explicit viewBox plus width/height and absolute, well-formed coordinates").
 * Operates on the parsed tree so it inspects the real root element, not a string
 * heuristic.
 *
 * @param svg - The SVG markup (for the error message).
 * @param doc - The parsed document from `assertWellFormed` (§3.2).
 * @throws {DiagramOutputError} If the root is not `<svg>`, or any of `viewBox`/
 *         `width`/`height` is missing or malformed.
 */
export function assertStructural(svg: string, doc: XmlDocument): void {
  const root = doc.root; // XmlElement | null
  if (!root || root.name !== "svg") {
    throw new DiagramOutputError("root element is not <svg>", "assertStructural");
  }
  const { viewBox, width, height } = root.attributes;
  if (!width || !height) {
    throw new DiagramOutputError(
      "root <svg> is missing explicit width/height (REQ-OUT-02)",
      "assertStructural",
    );
  }
  if (!viewBox) {
    throw new DiagramOutputError(
      "root <svg> is missing an explicit viewBox (REQ-OUT-02)",
      "assertStructural",
    );
  }
  // viewBox = "minX minY width height", four finite numbers.
  const parts = viewBox.trim().split(/\s+/);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(Number(p)))) {
    throw new DiagramOutputError(
      `viewBox "${viewBox}" is not four well-formed numbers (REQ-OUT-02)`,
      "assertStructural",
    );
  }
}

/**
 * Assert the SVG is font-portable (REQ-OUT-04, REQ-SEC-02): it MUST embed at least
 * one `@font-face` whose `src` is a `data:` URI (the subset font baked in by
 * svg-postprocess.ts, 04 §3) and MUST reference NO external font resource — no
 * `http(s)://` font URL, no CDN `<link>`, no `@import url(...)`. This is what makes
 * "opens identically everywhere" hold offline.
 *
 * Detection: require a `@font-face` rule containing `src:` with `url(data:`; reject
 * if any `url(http` or `url("http` or `@import` appears in the markup. A bare
 * `font-family` system reference alone (no embedded face) also fails, since that
 * renders differently across viewers (tech-spec §3.4).
 *
 * @param svg - The SVG markup to validate.
 * @throws {DiagramOutputError} If no embedded data-URI font face is present, or an
 *         external font URL/import is present.
 */
export function assertFontPortable(svg: string, embedFont: boolean = true): void {
  if (/@import\b/.test(svg) || /url\(\s*["']?https?:/i.test(svg)) {
    throw new DiagramOutputError(
      "rendered SVG references an external font/URL; fonts must be embedded (REQ-OUT-04)",
      "assertFontPortable",
    );
  }
  // With --embed-font=false the SVG deliberately uses a system font stack (no
  // embedded face); the offline byte-identical guarantee is waived for that run.
  if (!embedFont) return;
  const hasEmbeddedFace = /@font-face\b[^}]*\bsrc\s*:[^}]*url\(\s*["']?data:/is.test(svg);
  if (!hasEmbeddedFace) {
    throw new DiagramOutputError(
      "rendered SVG has no embedded data-URI @font-face; text would not be portable (REQ-OUT-04)",
      "assertFontPortable",
    );
  }
}

/**
 * Assert the SVG is accessibility-complete (REQ-A11Y-01): the root carries
 * `role="img"`, and the document contains a `<title>` and a `<desc>` (sourced from
 * `DiagramSpec.title`/`description`, 00 §2.4). Operates on the parsed tree so nested
 * `<title>`/`<desc>` are found regardless of formatting.
 *
 * @param doc - The parsed document from `assertWellFormed` (§3.2).
 * @throws {DiagramOutputError} If `role="img"` is absent on the root, or `<title>`
 *         or `<desc>` is missing.
 */
export function assertA11y(doc: XmlDocument): void {
  const root = doc.root;
  if (!root || root.attributes["role"] !== "img") {
    throw new DiagramOutputError('root <svg> is missing role="img" (REQ-A11Y-01)', "assertA11y");
  }
  if (!hasDescendant(root, "title")) {
    throw new DiagramOutputError("SVG is missing <title> (REQ-A11Y-01)", "assertA11y");
  }
  if (!hasDescendant(root, "desc")) {
    throw new DiagramOutputError("SVG is missing <desc> (REQ-A11Y-01)", "assertA11y");
  }
}

/** Depth-first search for the first element named `name` under `el`. */
function hasDescendant(el: XmlElement, name: string): boolean {
  for (const child of el.children) {
    if (child instanceof XmlElement) {
      if (child.name === name) return true;
      if (hasDescendant(child, name)) return true;
    }
  }
  return false;
}
