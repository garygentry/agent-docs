import { z } from "zod";

/**
 * Core definitions for the diagram-generator skill: the engine-neutral
 * `DiagramSpec` Zod schema, its inferred TypeScript types, the `RenderResult`
 * shape, and the determinism/contract constants. Every other diagram module
 * imports from here (00-core-definitions.md). Cross-field invariants (referential
 * integrity, type/field agreement) live in `validate.ts`, not this base schema.
 */

// ---------------------------------------------------------------------------
// Diagram-type and presentation enums (00 §2.1)
// ---------------------------------------------------------------------------

/**
 * The six supported diagram types (REQ-COV-01/02). `architecture` and the four
 * graph-shaped siblings compile to Graphviz DOT; `sequence` is laid out directly
 * (see 03-rendering-engine.md §2). This enum is the authority for `--type`
 * (05-cli-and-invocation.md) and selects the render path in `render.ts`.
 */
export const DiagramType = z.enum([
  "architecture",
  "flowchart",
  "sequence",
  "er",
  "state",
  "dataflow",
]);
/** The six supported diagram types (REQ-COV-01/02). */
export type DiagramType = z.infer<typeof DiagramType>;

/** Light or dark theme variant; one SVG is baked per variant (REQ-THEME-01). */
export const Theme = z.enum(["light", "dark"]);
/** Light or dark theme variant. */
export type Theme = z.infer<typeof Theme>;

/**
 * A `#rrggbb` hex color (lowercase or uppercase). Used for `accent` and validated
 * before theme resolution so a malformed color fails at input parse, not at
 * render (REQ-REL-02). Three-digit (`#abc`) and alpha forms are intentionally
 * rejected for portability across tier-2 viewers.
 */
export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "accent must be a #rrggbb hex color");
/** A `#rrggbb` hex color. */
export type HexColor = z.infer<typeof HexColor>;

/**
 * Canvas background choice (#10). `opaque` (the default) paints the theme's
 * background as a rounded, bordered panel so the diagram reads as a self-contained
 * card on any host surface; `transparent` omits the backdrop rect so the diagram
 * blends into the host; a `#rrggbb` value paints an explicit color. Text/stroke
 * colors still come from `theme`, so a transparent diagram reads on the consumer's
 * surface as long as the matching theme is chosen.
 */
export const Background = z.union([z.enum(["transparent", "opaque"]), HexColor]);
/** Canvas background choice. */
export type Background = z.infer<typeof Background>;

/**
 * Layout direction override for graph diagrams (#14) → Graphviz `rankdir`. When
 * omitted, the per-`diagramType` default applies (architecture/dataflow=LR,
 * flowchart/state=TB). Authors set this to avoid extreme aspect ratios on long
 * linear flows (e.g. `TB` for a 10-stage pipeline).
 */
export const Direction = z.enum(["LR", "TB", "RL", "BT"]);
/** Layout direction override (Graphviz `rankdir`). */
export type Direction = z.infer<typeof Direction>;

/**
 * Shape-fill presentation for role-colored nodes (and the matching legend
 * swatches). `translucent` (the default) paints the role color at
 * `fill-opacity="0.8"` so diagrams read softly over any surface; `solid` paints
 * the opaque role color; `transparent` is outline-only (`fill="none"`, stroke
 * kept). Implemented with the `fill-opacity` attribute (well-supported by
 * resvg/tier-2 viewers), never 8-digit hex (which `HexColor` rejects). CLI
 * `--fill-style` overrides.
 */
export const FillStyle = z.enum(["translucent", "solid", "transparent"]);
/** Shape-fill presentation for role-colored nodes. */
export type FillStyle = z.infer<typeof FillStyle>;

/**
 * Visual treatment of role-colored nodes. `elevated` (the default) gives nodes
 * rounded corners and a soft drop shadow so they read as cards lifted off the
 * panel; `flat` keeps square corners and no shadow for a plainer, lighter look.
 * CLI `--card-style` overrides.
 */
export const CardStyle = z.enum(["elevated", "flat"]);
/** Visual treatment of role-colored nodes. */
export type CardStyle = z.infer<typeof CardStyle>;

/**
 * Where the role legend is placed. `auto` (the default) chooses by layout —
 * predominantly horizontal diagrams get a legend row along the bottom, vertical
 * ones a column on the right — so the legend never distorts the aspect ratio.
 * `right`/`bottom` force a side; `none` omits the legend entirely. CLI `--legend`
 * overrides.
 */
export const LegendPlacement = z.enum(["auto", "right", "bottom", "none"]);
/** Legend placement choice. */
export type LegendPlacement = z.infer<typeof LegendPlacement>;

// ---------------------------------------------------------------------------
// Node, edge, and container (00 §2.2)
// ---------------------------------------------------------------------------

/**
 * The semantic role of a node — the key into the theme palette
 * (04-theme-postprocess-png.md §2) that drives "semantic component coloring"
 * (REQ-COV-01). Roles are intentionally a closed, engine-neutral taxonomy seeded
 * from the research's Cocoon palette (OTQ-2); an unknown role would silently lose
 * its color, so the set is fixed and validated. `default` is the uncolored
 * fallback used when a node has no meaningful type.
 */
export const NodeRole = z.enum([
  "default",
  "frontend",
  "backend",
  "database",
  "queue",
  "cache",
  "external",
  "security",
  "gateway",
  "storage",
  "compute",
]);
/** The semantic role of a node (theme palette key). */
export type NodeRole = z.infer<typeof NodeRole>;

/** Edge direction; controls arrowheads in the emitted DOT/SVG. */
export const EdgeDirection = z.enum(["forward", "back", "both", "none"]);
/** Edge direction. */
export type EdgeDirection = z.infer<typeof EdgeDirection>;

/** Edge line style. */
export const EdgeStyle = z.enum(["solid", "dashed", "dotted", "bold"]);
/** Edge line style. */
export type EdgeStyle = z.infer<typeof EdgeStyle>;

/** kebab/alnum node identifier; referenced by edges and container children. */
const NodeId = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/, "node id must be alphanumeric, dash, or underscore");

/** A single diagram node (component, box, entity, or state). */
export const Node = z.object({
  /** Unique identifier; referenced by `Edge.from`/`Edge.to` and `Container.children`. */
  id: NodeId,
  /**
   * Human-visible label rendered inside the box. Plain text (no markup). A `\n`
   * produces a line break on graph diagram types (stacked, centered lines; the box
   * grows to fit). Sequence labels are single-line (see `Participant`/`Message`).
   */
  label: z.string().min(1),
  /** Semantic color key (REQ-COV-01); omitted → `"default"`. */
  role: NodeRole.optional(),
  /** Optional shape hint; defaults are chosen per diagram type if omitted. */
  shape: z.enum(["box", "rounded", "cylinder", "diamond", "ellipse"]).optional(),
});
/** A single diagram node. */
export type Node = z.infer<typeof Node>;

/** A directed (or undirected) connection between two nodes. */
export const Edge = z.object({
  /** Source node id; MUST exist in `nodes` (cross-checked, 00 §3.1). */
  from: NodeId,
  /** Target node id; MUST exist in `nodes` (cross-checked, 00 §3.1). */
  to: NodeId,
  /** Optional edge label rendered alongside the connector. */
  label: z.string().optional(),
  /** Arrow direction; defaults to `"forward"`. */
  direction: EdgeDirection.optional(),
  /** Line style; defaults to `"solid"`. */
  style: EdgeStyle.optional(),
});
/** A directed connection between two nodes. */
export type Edge = z.infer<typeof Edge>;

/**
 * A boundary/group that visually encloses a set of nodes (a Graphviz cluster).
 * Used for architecture-diagram trust boundaries and subsystem grouping
 * (REQ-COV-01). `children` reference node ids; nesting is via `parent`.
 */
export const Container = z.object({
  /** Unique container id (namespace shared with nodes for reference checks). */
  id: NodeId,
  /** Boundary label rendered on the cluster edge. */
  label: z.string().min(1),
  /** Node ids enclosed by this container; each MUST exist in `nodes` (00 §3.1). */
  children: z.array(NodeId).default([]),
  /** Optional parent container id for nesting; MUST exist in `containers` (00 §3.1). */
  parent: NodeId.optional(),
});
/** A boundary/group enclosing a set of nodes. */
export type Container = z.infer<typeof Container>;

// ---------------------------------------------------------------------------
// Sequence-specific shapes (00 §2.3)
// ---------------------------------------------------------------------------

/** A sequence-diagram lifeline. */
export const Participant = z.object({
  /** Unique participant id; referenced by `Message.from`/`Message.to`. */
  id: NodeId,
  /** Lifeline header label. */
  label: z.string().min(1),
  /** Optional semantic role for the lifeline header color. */
  role: NodeRole.optional(),
});
/** A sequence-diagram lifeline. */
export type Participant = z.infer<typeof Participant>;

/** A single message arrow between two participants, in document order. */
export const Message = z.object({
  /** Source participant id; MUST exist in `participants` (00 §3.1). */
  from: NodeId,
  /** Target participant id; MUST exist in `participants` (00 §3.1). */
  to: NodeId,
  /** Message label. */
  label: z.string().min(1),
  /** Arrow style: `sync` (solid), `async` (open), or `reply` (dashed). */
  kind: z.enum(["sync", "async", "reply"]).default("sync"),
  /** Whether this message activates the target (draws an activation bar). */
  activate: z.boolean().optional(),
});
/** A single sequence message arrow. */
export type Message = z.infer<typeof Message>;

// ---------------------------------------------------------------------------
// The DiagramSpec object (00 §2.4)
// ---------------------------------------------------------------------------

/**
 * The complete engine-neutral diagram specification — the single structured input
 * to the render pipeline (tech-spec §4). Natural-language mode (REQ-IN-01)
 * produces an instance of this from prose (05-cli-and-invocation.md §4); the CLI
 * accepts it as JSON. `title`/`description` flow into the SVG `<title>`/`<desc>`
 * (REQ-A11Y-01). `theme`/`accent` are defaults that CLI flags override (00 §6,
 * 05-cli-and-invocation.md §2). Built with `.strict()` so unknown top-level keys
 * fail loudly at parse; cross-field invariants are layered on in `validate.ts`.
 */
export const DiagramSpec = z
  .object({
    /** Which of the six diagram types to render (REQ-COV-01/02). */
    diagramType: DiagramType,
    /** Diagram title → SVG `<title>` and the rendered heading (REQ-A11Y-01). */
    title: z.string().min(1),
    /** Accessible description → SVG `<desc>` (REQ-A11Y-01). */
    description: z.string().min(1),
    /** Default theme variant; CLI `--theme` overrides. Defaults `"light"`. */
    theme: Theme.default("light"),
    /** Optional accent/brand color; CLI `--accent` overrides (REQ-THEME-01). */
    accent: HexColor.optional(),
    /** Canvas background; CLI `--background` overrides. Omitted → `"opaque"` (#10). */
    background: Background.optional(),
    /** Optional layout direction override for graph types; CLI `--direction` overrides (#14). */
    direction: Direction.optional(),
    /** Shape-fill style for role nodes + legend swatches; CLI `--fill-style` overrides. Omitted → `"translucent"`. */
    fill: FillStyle.optional(),
    /** Node card treatment; CLI `--card-style` overrides. Omitted → `"elevated"`. */
    cardStyle: CardStyle.optional(),
    /** Legend placement; CLI `--legend` overrides. Omitted → `"auto"`. */
    legend: LegendPlacement.optional(),
    /** Graph nodes (empty for sequence diagrams). */
    nodes: z.array(Node).default([]),
    /** Graph edges (empty for sequence diagrams). */
    edges: z.array(Edge).default([]),
    /** Optional boundary/group clusters (REQ-COV-01). */
    containers: z.array(Container).default([]),
    /** Sequence lifelines (only for `diagramType="sequence"`). */
    participants: z.array(Participant).default([]),
    /** Sequence messages in document order (only for `diagramType="sequence"`). */
    messages: z.array(Message).default([]),
  })
  .strict();
/** The complete engine-neutral diagram specification. */
export type DiagramSpec = z.infer<typeof DiagramSpec>;

// ---------------------------------------------------------------------------
// Render result (00 §3.2)
// ---------------------------------------------------------------------------

/** The in-memory result of rendering one DiagramSpec into one theme variant. */
export interface RenderResult {
  /** The validated, post-processed, tier-2-portable SVG markup (REQ-OUT-01). */
  svg: string;
  /** Intrinsic width in px, mirrored into the SVG `width`/`viewBox` (REQ-OUT-02). */
  width: number;
  /** Intrinsic height in px, mirrored into the SVG `height`/`viewBox` (REQ-OUT-02). */
  height: number;
  /** The theme variant baked into `svg` (REQ-THEME-01). */
  theme: Theme;
  /** Slug derived from `title`, used by the `--out-dir` naming convenience (00 §6). */
  slug: string;
}

// ---------------------------------------------------------------------------
// Error codes + exit-code map (00 §5–6)
// ---------------------------------------------------------------------------

/** Stable error codes; also the stderr prefix and the basis of the exit map. */
export type DiagramErrorCode =
  | "INPUT_INVALID" // Zod parse / cross-field validation failed (REQ-REL-02)
  | "RENDER_FAILED" // DOT/Graphviz or sequence layout error (03)
  | "OUTPUT_INVALID" // post-render assertions failed (REQ-OUT/A11Y, 02 §3)
  | "PNG_FAILED" // resvg rasterization failed (04 §4)
  | "IO_ERROR" // filesystem write / path confinement (REQ-SEC-01)
  | "USAGE_ERROR"; // bad CLI flags / missing input (05 §3)

// ---------------------------------------------------------------------------
// Constants (00 §6)
// ---------------------------------------------------------------------------

/**
 * The scriptable-contract version (REQ-INV-04). `--version` prints this; a
 * breaking change to CLI flags, IO semantics, output-path rules, artifact
 * formats, or exit codes (05-cli-and-invocation.md §2/§3) REQUIRES a bump so
 * consumers like doc-site can pin against a known release. Semantic
 * versioning: MAJOR = breaking contract change.
 */
export const CONTRACT_VERSION = "1.2.0" as const;

/**
 * Exit-code map keyed by error code (00 §5). `0` is success. Distinct non-zero
 * codes let scripted callers distinguish input vs output vs IO failures. Stable
 * part of the contract (REQ-INV-04, 05 §3).
 */
export const EXIT_CODES: Record<DiagramErrorCode, number> = {
  INPUT_INVALID: 2,
  RENDER_FAILED: 3,
  OUTPUT_INVALID: 4,
  PNG_FAILED: 5,
  IO_ERROR: 6,
  USAGE_ERROR: 64, // sysexits EX_USAGE
};

/** Default artifact format when `--format` is omitted (05 §2). */
export const DEFAULT_FORMAT = "svg" as const;

/** Default theme when neither spec nor `--theme` specifies one (REQ-THEME-01). */
export const DEFAULT_THEME: Theme = "light";

/**
 * Fixed coordinate decimal precision for the determinism canonicalization pass
 * (REQ-REPRO-01, OTQ-6; see 04-theme-postprocess-png.md §3).
 */
export const SVG_COORD_PRECISION = 2 as const;
