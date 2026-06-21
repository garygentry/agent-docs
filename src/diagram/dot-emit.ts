import { DiagramRenderError } from "./errors.js";
import type { Container, DiagramSpec, Node } from "./schema.js";

/**
 * `dot-emit.ts` — compile a graph-shaped `DiagramSpec` into a Graphviz DOT string
 * (03-rendering-engine.md §2). The emitted DOT is deliberately tier-2-portable: it
 * uses ONLY quoted string labels and standard vector shapes — never HTML-like
 * labels (`label=<…>`) or record shapes — so the SVG `@viz-js/viz` produces is
 * plain-`<text>` (REQ-OUT-01, §2.1). Node `role` is carried as
 * `class="role-<role>"` for later coloring in `svg-postprocess.ts` (04 §3); color
 * is NOT baked here (§2.5). Output is a pure, deterministic function of `spec`
 * (REQ-REPRO-01, §2.6).
 */

/**
 * Maps the engine-neutral `Node.shape` (00 §2.2) to a Graphviz `shape=`/`style=`
 * pair. `rounded` is a box with rounded style (Graphviz has no `rounded` shape).
 * All targets render as plain `<text>`-labelled vector shapes (REQ-OUT-01).
 */
const SHAPE_MAP: Record<NonNullable<Node["shape"]>, { shape: string; style?: string }> = {
  box: { shape: "box" },
  rounded: { shape: "box", style: "rounded" },
  cylinder: { shape: "cylinder" },
  diamond: { shape: "diamond" },
  ellipse: { shape: "ellipse" },
};

/**
 * Per-`diagramType` DOT defaults (03 §2.2). `rankdir` is a deterministic function
 * of `diagramType` (not user-configurable, §2.2); `defaultShape` is the node shape
 * used when a `Node` has no explicit `shape`; `defaultEdgeDir` is the edge
 * direction applied when an `Edge` omits `direction` (ER associations are
 * undirected by default).
 */
const TYPE_DEFAULTS: Record<
  Exclude<DiagramSpec["diagramType"], "sequence">,
  { rankdir: string; defaultShape: NonNullable<Node["shape"]>; defaultEdgeDir: string }
> = {
  architecture: { rankdir: "LR", defaultShape: "box", defaultEdgeDir: "forward" },
  flowchart: { rankdir: "TB", defaultShape: "box", defaultEdgeDir: "forward" },
  er: { rankdir: "LR", defaultShape: "box", defaultEdgeDir: "none" },
  state: { rankdir: "TB", defaultShape: "rounded", defaultEdgeDir: "forward" },
  dataflow: { rankdir: "LR", defaultShape: "box", defaultEdgeDir: "forward" },
};

/**
 * Escape user text for the DOT double-quoted string grammar (§2.7): backslash,
 * double-quote, and newline. `<`/`>` are passed through as literal characters
 * inside the quoted string, never as HTML-label delimiters, so the tier-2
 * invariant (§2.1) holds even for labels containing angle brackets.
 */
function escapeDot(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * Sanitize an id into a Graphviz `cluster_*` subgraph name. `Node`/`Container`
 * ids are already constrained to `[A-Za-z0-9_-]+` (00 §2.2); we still quote the
 * resulting name when emitted so any character is safe.
 */
function clusterName(id: string): string {
  return `cluster_${id}`;
}

/** Emit a single node declaration line (label + role class + shape). */
function emitNode(node: Node, defaultShape: NonNullable<Node["shape"]>, indent: string): string {
  const role = node.role ?? "default";
  const shapeInfo = SHAPE_MAP[node.shape ?? defaultShape];
  const attrs = [
    `label="${escapeDot(node.label)}"`,
    `class="role-${role}"`,
    `shape=${shapeInfo.shape}`,
  ];
  if (shapeInfo.style !== undefined) {
    attrs.push(`style=${shapeInfo.style}`);
  }
  return `${indent}"${escapeDot(node.id)}" [${attrs.join(", ")}];`;
}

/**
 * Compile an engine-neutral `DiagramSpec` into a Graphviz DOT string for one of
 * the five graph-shaped diagram types (`architecture`, `flowchart`, `er`,
 * `state`, `dataflow`). The result is fed to `renderGraph` (§3).
 *
 * The emitted DOT uses ONLY quoted string labels and standard vector shapes — it
 * never emits HTML-like labels or record shapes — so the SVG `@viz-js/viz`
 * produces is plain-`<text>` and tier-2 portable (REQ-OUT-01, §2.1). Node
 * `role` is carried as `class="role-<role>"` for later coloring in
 * `svg-postprocess.ts` (04 §3); color is NOT baked here (§2.5). Output is a pure,
 * deterministic function of `spec` (REQ-REPRO-01, §2.6).
 *
 * @param spec - A validated `DiagramSpec` whose `diagramType` is NOT `"sequence"`
 *   (sequence is handled by `renderSequence`, §4; `render.ts` enforces the branch).
 * @returns A Graphviz DOT source string.
 * @throws {DiagramRenderError} (code `RENDER_FAILED`) if called with
 *   `diagramType === "sequence"` (caller contract violation) or if an edge/child
 *   references an id absent from `nodes` — though referential integrity is already
 *   guaranteed by validation (02 §2), this is a defensive fail-loud guard.
 */
export function emitDot(spec: DiagramSpec): string {
  if (spec.diagramType === "sequence") {
    throw new DiagramRenderError(
      "emitDot does not handle sequence diagrams — use renderSequence",
      "diagramType=sequence",
    );
  }

  const defaults = TYPE_DEFAULTS[spec.diagramType];

  // Defensive referential-integrity guards (§2.8). Validation (02 §2) already
  // guarantees these, but emitDot fails loudly rather than producing dangling DOT.
  const nodeById = new Map<string, Node>();
  for (const node of spec.nodes) {
    nodeById.set(node.id, node);
  }
  const containerIds = new Set(spec.containers.map((c) => c.id));

  for (const edge of spec.edges) {
    if (!nodeById.has(edge.from)) {
      throw new DiagramRenderError("edge references an unknown node id", `edge.from=${edge.from}`);
    }
    if (!nodeById.has(edge.to)) {
      throw new DiagramRenderError("edge references an unknown node id", `edge.to=${edge.to}`);
    }
  }
  for (const container of spec.containers) {
    for (const childId of container.children) {
      if (!nodeById.has(childId)) {
        throw new DiagramRenderError(
          "container references an unknown node id",
          `container=${container.id} child=${childId}`,
        );
      }
    }
    if (container.parent !== undefined && !containerIds.has(container.parent)) {
      throw new DiagramRenderError(
        "container references an unknown parent container id",
        `container=${container.id} parent=${container.parent}`,
      );
    }
  }

  const lines: string[] = [];
  lines.push("digraph {");
  lines.push(`  rankdir=${defaults.rankdir};`);
  lines.push(`  node [fontname="DiagramSans"];`);

  // Track which nodes are emitted inside a cluster so the top-level pass skips
  // them (Graphviz assigns cluster membership by lexical scope, §2.4).
  const nodesInContainers = new Set<string>();
  for (const container of spec.containers) {
    for (const childId of container.children) {
      nodesInContainers.add(childId);
    }
  }

  // Emit clusters depth-first. Order: spec.containers order for top-level
  // clusters; Container.children order for child nodes; spec.containers order for
  // nested clusters (§2.4, §2.6).
  const emitCluster = (container: Container, indent: string): void => {
    lines.push(`${indent}subgraph "${clusterName(container.id)}" {`);
    const inner = `${indent}  `;
    lines.push(`${inner}label="${escapeDot(container.label)}";`);
    lines.push(`${inner}class="container";`);
    for (const childId of container.children) {
      const node = nodeById.get(childId);
      if (node !== undefined) {
        lines.push(emitNode(node, defaults.defaultShape, inner));
      }
    }
    for (const child of spec.containers) {
      if (child.parent === container.id) {
        emitCluster(child, inner);
      }
    }
    lines.push(`${indent}}`);
  };

  for (const container of spec.containers) {
    if (container.parent === undefined) {
      emitCluster(container, "  ");
    }
  }

  // Top-level nodes: those not enclosed by any container, in spec.nodes order.
  for (const node of spec.nodes) {
    if (!nodesInContainers.has(node.id)) {
      lines.push(emitNode(node, defaults.defaultShape, "  "));
    }
  }

  // Edges in spec.edges order.
  for (const edge of spec.edges) {
    const attrs: string[] = [];
    if (edge.label !== undefined) {
      attrs.push(`label="${escapeDot(edge.label)}"`);
    }
    const dir = edge.direction ?? defaults.defaultEdgeDir;
    if (dir !== "forward") {
      attrs.push(`dir=${dir}`);
    }
    if (edge.style !== undefined && edge.style !== "solid") {
      attrs.push(`style=${edge.style}`);
    }
    const head = `  "${escapeDot(edge.from)}" -> "${escapeDot(edge.to)}"`;
    lines.push(attrs.length > 0 ? `${head} [${attrs.join(", ")}];` : `${head};`);
  }

  lines.push("}");
  return lines.join("\n") + "\n";
}
