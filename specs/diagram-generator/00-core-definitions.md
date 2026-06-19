# 00 — Core Definitions

Shared type system, the engine-neutral `DiagramSpec` Zod schema, the error
hierarchy, and the determinism/contract constants for the `diagram-generator`
skill. **Every other spec document in this suite references definitions here.**

All code is TypeScript targeting Bun (CON-01, tech-spec §1). Modules are ESM
(`"type": "module"`). Zod is the single source of truth for any externally
authored data (the `DiagramSpec`); `zod-to-json-schema` derives the committed
`schemas/diagram-input.schema.json` (see `02-schema-and-validation.md`).
Conventions match the existing repo (`src/model.ts`): `PascalCase` types,
`SCREAMING_SNAKE` constants, `camelCase` values, and a `/** … */` doc comment on
every exported symbol and field.

## Requirement Coverage

| REQ ID | Requirement | Section |
| --- | --- | --- |
| REQ-IN-02 | Engine-neutral structured spec (nodes/edges/containers) | 2, 3 |
| REQ-COV-01 | Architecture diagrams + semantic role color | 2.2, 2.4, 4 |
| REQ-COV-02 | flowchart/sequence/ER/state/data-flow types | 2.1, 2.5 |
| REQ-THEME-01 | light/dark variants + configurable accent | 2.3, 4 |
| REQ-A11Y-01 | `<title>`/`<desc>`/`role="img"` source fields | 2.2 |
| REQ-REL-02 | Fail loudly — typed error hierarchy | 5 |
| REQ-INV-04 | Versioned contract — `CONTRACT_VERSION` | 6 |
| REQ-OUT-02 | viewBox/width/height — render-result shape | 3.2 |
| REQ-SEC-01 | Path-confinement error | 5 |

## 1. Module placement

All definitions in this document live in `src/diagram/schema.ts` (the Zod schema
and inferred types) and `src/diagram/errors.ts` (the error hierarchy and exit-code
map), with shared constants co-located in `schema.ts`. See
`01-architecture-layout.md` for the full module tree and how these are imported by
the render pipeline. The repo already has a sibling `src/errors.ts` for the
emitter; the diagram error types are **separate** and namespaced under
`src/diagram/` to keep the skill self-contained for bundling (tech-spec §3.3).

## 2. The engine-neutral DiagramSpec (REQ-IN-02)

`DiagramSpec` is the **engine-neutral** structured input: it describes a diagram
in terms of `nodes`, `edges`, and `containers` — never Graphviz DOT, which is an
internal compile target only (`03-rendering-engine.md`). Authoring this spec
requires no knowledge of the rendering engine (REQ-USE-01).

### 2.1 Diagram-type and presentation enums (REQ-COV-02, REQ-THEME-01)

```typescript
import { z } from "zod";

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
export const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "accent must be a #rrggbb hex color");
/** A `#rrggbb` hex color. */
export type HexColor = z.infer<typeof HexColor>;
```

### 2.2 Node, edge, and container (REQ-IN-02, REQ-COV-01, REQ-A11Y-01)

```typescript
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
  /** Human-visible label rendered inside the box. Plain text (no markup). */
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
  /** Source node id; MUST exist in `nodes` (cross-checked, §3.1). */
  from: NodeId,
  /** Target node id; MUST exist in `nodes` (cross-checked, §3.1). */
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
  /** Node ids enclosed by this container; each MUST exist in `nodes` (§3.1). */
  children: z.array(NodeId).default([]),
  /** Optional parent container id for nesting; MUST exist in `containers` (§3.1). */
  parent: NodeId.optional(),
});
/** A boundary/group enclosing a set of nodes. */
export type Container = z.infer<typeof Container>;
```

### 2.3 Sequence-specific shapes (REQ-COV-02)

Sequence diagrams do not use the graph `nodes`/`edges` model; they carry
`participants` and ordered `messages`, consumed by `sequence-svg.ts`
(`03-rendering-engine.md` §3). These fields are present only when
`diagramType === "sequence"` and are cross-validated in §3.1.

```typescript
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
  /** Source participant id; MUST exist in `participants` (§3.1). */
  from: NodeId,
  /** Target participant id; MUST exist in `participants` (§3.1). */
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
```

### 2.4 The DiagramSpec object (REQ-IN-02, REQ-A11Y-01, REQ-THEME-01)

```typescript
/**
 * The complete engine-neutral diagram specification — the single structured input
 * to the render pipeline (tech-spec §4). Natural-language mode (REQ-IN-01)
 * produces an instance of this from prose (05-cli-and-invocation.md §4); the CLI
 * accepts it as JSON. `title`/`description` flow into the SVG `<title>`/`<desc>`
 * (REQ-A11Y-01). `theme`/`accent` are defaults that CLI flags override (§6,
 * 05-cli-and-invocation.md §2).
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
```

> **`.strict()` rationale:** unknown top-level keys are rejected so typos
> (`node` vs `nodes`) fail loudly at parse rather than silently dropping content
> (REQ-REL-02). Cross-field invariants that Zod's object schema cannot express
> (referential integrity, type/field agreement) are layered on as a
> `superRefine` — see §3.1 and `02-schema-and-validation.md` §2.

### 2.5 Diagram-type ↔ field agreement

The single `DiagramSpec` shape serves all six types, but two field families are
mutually exclusive by type. This invariant is enforced in the `superRefine`
(§3.1), not the base object:

| `diagramType` | Populated fields | Empty fields |
| --- | --- | --- |
| `architecture`, `flowchart`, `er`, `state`, `dataflow` | `nodes`, `edges`, `containers` | `participants`, `messages` |
| `sequence` | `participants`, `messages` | `nodes`, `edges`, `containers` |

## 3. Derived shapes

### 3.1 Cross-field validation contract (REQ-IN-02, REQ-REL-02)

Beyond per-field Zod validation, `DiagramSpec` carries a `superRefine` (defined in
`02-schema-and-validation.md` §2) enforcing:

1. **Referential integrity** — every `Edge.from`/`Edge.to`, `Container.children[]`,
   `Container.parent`, and `Message.from`/`Message.to` references an id that exists
   in the corresponding collection.
2. **Unique ids** — `nodes`, `containers`, and `participants` each have unique ids;
   the node/container id namespaces do not collide.
3. **Type/field agreement** — the §2.5 table; e.g. a `sequence` spec with non-empty
   `nodes`, or a `flowchart` spec with empty `nodes`, is rejected.

These produce `DiagramInputError` (§5) with the offending JSON path.

### 3.2 Render result (REQ-OUT-02)

The internal product of the render pipeline, before serialization to disk
(`03-rendering-engine.md` §5, `05-cli-and-invocation.md` §3):

```typescript
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
  /** Slug derived from `title`, used by the `--out-dir` naming convenience (§6). */
  slug: string;
}
```

## 4. Theme tokens (forward reference)

The concrete `NodeRole`→color map and the light/dark token values resolve OTQ-2 and
are specified in `04-theme-postprocess-png.md` §2. `00` fixes only the *keys*
(`NodeRole`, `Theme`) so every other document references a stable vocabulary; the
*values* live in `theme.ts`.

## 5. Error hierarchy (REQ-REL-02, REQ-SEC-01)

All failures are typed, carry a stable `code`, and map to a process exit code. The
CLI (`05-cli-and-invocation.md` §3) catches `DiagramError`, prints `message` to
stderr, and exits with `exitCode`. **No partial artifact is ever written** on any
of these (REQ-REL-01/02).

```typescript
/** Stable error codes; also the stderr prefix and the basis of the exit map. */
export type DiagramErrorCode =
  | "INPUT_INVALID" // Zod parse / cross-field validation failed (REQ-REL-02)
  | "RENDER_FAILED" // DOT/Graphviz or sequence layout error (03)
  | "OUTPUT_INVALID" // post-render assertions failed (REQ-OUT/A11Y, 02 §3)
  | "PNG_FAILED" // resvg rasterization failed (04 §4)
  | "IO_ERROR" // filesystem write / path confinement (REQ-SEC-01)
  | "USAGE_ERROR"; // bad CLI flags / missing input (05 §3)

/**
 * Base class for every diagram-generator failure. `code` is machine-stable;
 * `exitCode` is what the CLI returns; `detail` carries context (a JSON path, a
 * failed assertion name) included in the stderr message.
 */
export class DiagramError extends Error {
  /** Stable, machine-readable code. */
  readonly code: DiagramErrorCode;
  /** Process exit code the CLI returns for this error (see EXIT_CODES). */
  readonly exitCode: number;
  /** Optional context (offending path, assertion name) for the operator. */
  readonly detail?: string;

  constructor(code: DiagramErrorCode, message: string, detail?: string) {
    super(message);
    this.name = "DiagramError";
    this.code = code;
    this.exitCode = EXIT_CODES[code];
    this.detail = detail;
  }
}

/** Input failed Zod parse or cross-field validation (REQ-REL-02). */
export class DiagramInputError extends DiagramError {
  constructor(message: string, detail?: string) {
    super("INPUT_INVALID", message, detail);
    this.name = "DiagramInputError";
  }
}

/** The engine (Graphviz-WASM or sequence layout) failed to produce SVG. */
export class DiagramRenderError extends DiagramError {
  constructor(message: string, detail?: string) {
    super("RENDER_FAILED", message, detail);
    this.name = "DiagramRenderError";
  }
}

/** Post-render output assertions failed (tier-2 / viewBox / font / a11y). */
export class DiagramOutputError extends DiagramError {
  constructor(message: string, detail?: string) {
    super("OUTPUT_INVALID", message, detail);
    this.name = "DiagramOutputError";
  }
}

/** PNG rasterization via resvg failed (REQ-OUT-03). */
export class DiagramPngError extends DiagramError {
  constructor(message: string, detail?: string) {
    super("PNG_FAILED", message, detail);
    this.name = "DiagramPngError";
  }
}

/** A filesystem write failed or attempted to escape the caller's path (REQ-SEC-01). */
export class DiagramIoError extends DiagramError {
  constructor(message: string, detail?: string) {
    super("IO_ERROR", message, detail);
    this.name = "DiagramIoError";
  }
}

/** Invalid CLI usage (unknown flag, missing input, conflicting paths). */
export class DiagramUsageError extends DiagramError {
  constructor(message: string, detail?: string) {
    super("USAGE_ERROR", message, detail);
    this.name = "DiagramUsageError";
  }
}
```

## 6. Constants (REQ-INV-04)

```typescript
/**
 * The scriptable-contract version (REQ-INV-04). `--version` prints this; a
 * breaking change to CLI flags, IO semantics, output-path rules, artifact
 * formats, or exit codes (05-cli-and-invocation.md §2/§3) REQUIRES a bump so
 * consumers like doc-site-plugin can pin against a known release. Semantic
 * versioning: MAJOR = breaking contract change.
 */
export const CONTRACT_VERSION = "1.0.0" as const;

/**
 * Exit-code map keyed by error code (§5). `0` is success. Distinct non-zero codes
 * let scripted callers distinguish input vs output vs IO failures. Stable part of
 * the contract (REQ-INV-04, 05 §3).
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

/** Fixed coordinate decimal precision for the determinism canonicalization pass
 * (REQ-REPRO-01, OTQ-6; see 04-theme-postprocess-png.md §3). */
export const SVG_COORD_PRECISION = 2 as const;
```

## 7. Module exports

`src/diagram/schema.ts` exports: `DiagramType`, `Theme`, `HexColor`, `NodeRole`,
`EdgeDirection`, `EdgeStyle`, `Node`, `Edge`, `Container`, `Participant`,
`Message`, `DiagramSpec` (Zod + inferred types), plus the constants in §6.
`src/diagram/errors.ts` exports the §5 error classes and `DiagramErrorCode`. These
are internal to the repo and the bundle — **not** a public consumer contract; the
only consumer-facing surface is the CLI (`05-cli-and-invocation.md`). See
`01-architecture-layout.md` §3 for the import graph.

## Dependencies

- None (this is the foundation document). Depends only on the external `zod`
  package (already a repo runtime dependency).

## Verification

- [ ] `DiagramSpec.parse()` accepts a minimal valid architecture spec and a minimal
      valid sequence spec.
- [ ] `.strict()` rejects an unknown top-level key with `INPUT_INVALID`.
- [ ] A bad `accent` (`#abc`, `red`) is rejected at parse.
- [ ] Every exported type has a `/** … */` doc comment (matches `src/model.ts`).
- [ ] `CONTRACT_VERSION` and `EXIT_CODES` are exported and referenced by the CLI
      (`05-cli-and-invocation.md`).
- [ ] Each error subclass sets a distinct `code` and the matching `EXIT_CODES`
      entry.
