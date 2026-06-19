# 02 — Schema & Validation

Two related concerns for the `diagram-generator` skill: (1) the **cross-field
validation** layered onto `DiagramSpec` and the **two-stage validate-then-emit**
contract (input parse → render → output assertions), and (2) the **committed JSON
Schema generation** for the engine-neutral input. Code in this document lives in
two modules: `src/diagram/validate.ts` (the `superRefine` that backs `DiagramSpec`
plus the post-render output assertions) and `src/diagram/schema-gen.ts` (the
standalone Zod→JSON-Schema generator with drift guard). Both build directly on the
types, errors, and constants defined in `00-core-definitions.md` and the module
placement in `01-architecture-layout.md`; nothing here redefines a shared type.

## Requirement Coverage

| REQ ID | Requirement | Section |
| --- | --- | --- |
| REQ-IN-02 | Engine-neutral structured spec — cross-field integrity | 2 |
| REQ-IN-03 | MUST NOT invent semantic content (authoring-enforced) | 4 |
| REQ-REL-01 | Validate well-formed/renderable before emitting | 2, 3 |
| REQ-REL-02 | Fail loudly; no broken artifact emitted | 2, 3 |
| REQ-OUT-02 | Explicit viewBox + width/height, well-formed coordinates | 3.4 |
| REQ-OUT-04 | No external font/CDN; embedded data-URI font | 3.5 |
| REQ-A11Y-01 | `<title>`/`<desc>`/`role="img"` present | 3.6 |
| REQ-DISC-03 (analog) | JSON Schema generation + drift guard | 5 |

> **Cross-document note (REQ-OUT-01):** the tier-2-clean assertion (§3.3) checks the
> property mandated by REQ-OUT-01 (plain `<text>`, no `<foreignObject>`). REQ-OUT-01
> itself is *owned* by `03-rendering-engine.md` (the renderer must produce it); §3.3
> is the validation gate that proves it.

## 1. Module placement & dependency direction

```
schema.ts ──► validate.ts        (DiagramSpec.superRefine is defined in validate.ts,
                                   imported back into the DiagramSpec in schema.ts —
                                   see §2.1 wiring note)
schema.ts ──► schema-gen.ts      (standalone generator; NOT imported by cli.ts — keeps
                                   zod-to-json-schema out of the shipped bundle, 01 §3)
```

Per `01-architecture-layout.md` §3, `validate.ts` is imported by `render.ts`
(output assertions run after the engine produces SVG) and its `superRefine` is the
cross-field rule referenced from `00-core-definitions.md` §3.1. `schema-gen.ts` is
a standalone script run by `schema:gen:diagram` / `schema:check:diagram` (01 §5),
never part of the CLI bundle.

All types referenced below (`DiagramSpec`, `Node`, `Edge`, `Container`,
`Participant`, `Message`, `DiagramInputError`, `DiagramOutputError`) come from
`00-core-definitions.md`. The `RenderResult` shape consumed downstream is `00` §3.2.

---

## 2. Cross-field validation — `diagramSuperRefine` (REQ-IN-02, REQ-REL-01/02)

Per-field Zod validation in `00-core-definitions.md` §2 covers shapes, enums, and
id syntax. It cannot express invariants that span collections: referential
integrity, id uniqueness, namespace non-collision, and diagram-type↔field
agreement (the `00` §2.5 table). These are layered on as a single `superRefine`
defined here and attached to `DiagramSpec` in `schema.ts`.

### 2.1 Wiring note (how `schema.ts` consumes this)

`00-core-definitions.md` §2.4 defines `DiagramSpec` as a `z.object({…}).strict()`.
To attach the cross-field rule without creating an import cycle that pollutes the
bundle, `schema.ts` imports `diagramSuperRefine` from `validate.ts` and applies it:

```typescript
// in src/diagram/schema.ts (00 §2.4), final form:
import { diagramSuperRefine } from "./validate.js";

export const DiagramSpec = z
  .object({ /* … fields from 00 §2.4 … */ })
  .strict()
  .superRefine(diagramSuperRefine);
```

`validate.ts` imports only the **inferred TS type** of the base object for typing
the refine callback (it does not import the refined `DiagramSpec`, avoiding a
cycle). The callback operates on the parsed object, so by the time it runs every
field already satisfies its per-field schema.

### 2.2 The refine function

```typescript
import { z } from "zod";
import type { DiagramType } from "./schema.js";

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
 * Cross-field validation for `DiagramSpec` (00 §3.1), attached as a `superRefine`
 * in `schema.ts`. Enforces, in order:
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
 * JSON path, e.g. `["edges", 3, "to"]`). Zod aggregates these; the CLI wraps the
 * resulting `ZodError` into a `DiagramInputError` (§2.4) carrying the joined paths.
 * This function NEVER throws — it only records issues — so all violations surface
 * in one pass (REQ-REL-02: report fully, fail once).
 *
 * @param spec - The per-field-valid, defaulted DiagramSpec object.
 * @param ctx - Zod refinement context; issues are added here.
 */
export function diagramSuperRefine(
  spec: DecodedSpec,
  ctx: z.RefinementCtx,
): void {
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
function reportDuplicates(
  items: Array<{ id: string }>,
  field: string,
  ctx: z.RefinementCtx,
): void {
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
```

### 2.3 Worked example (rejected input)

```jsonc
{
  "diagramType": "flowchart",
  "title": "Bad", "description": "d",
  "nodes": [{ "id": "a", "label": "A" }, { "id": "a", "label": "A2" }],
  "edges": [{ "from": "a", "to": "ghost" }]
}
```

Produces three issues: `["nodes",1,"id"]` (duplicate id `a`),
`["edges",0,"to"]` (`ghost` references no node), and — note — rule 4 passes
(`nodes` non-empty, sequence fields empty). The CLI joins these into one
`DiagramInputError` message and exits `EXIT_CODES.INPUT_INVALID` (= 2).

### 2.4 Parse entry point — `parseSpec` (REQ-REL-02)

The single function the CLI calls to obtain a validated spec. It is the only place
a raw `ZodError` is converted to the typed `DiagramInputError` from
`00-core-definitions.md` §5.

```typescript
import { DiagramSpec, type DiagramSpec as DiagramSpecT } from "./schema.js";
import { DiagramInputError } from "./errors.js";

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
  const result = DiagramSpec.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`)
      .join("\n");
    throw new DiagramInputError("diagram input failed validation", detail);
  }
  return result.data;
}
```

---

## 3. Two-stage validation — output assertions (REQ-REL-01/02, REQ-OUT-02/04, REQ-A11Y-01)

**Stage 1** is §2.4 (`parseSpec`). **Stage 2** runs *after* the engine produces SVG
markup but *before* any byte is written to disk (`render.ts`, `01` §3). Every Stage-2
failure is a `DiagramOutputError` (`00` §5, code `OUTPUT_INVALID`, exit 4). The
aggregator `assertOutputValid` runs all five assertions; the caller writes the
artifact only if it returns normally (REQ-REL-01: "no partial artifact written on
failure").

### 3.1 Aggregator — `assertOutputValid`

```typescript
import { parseXml } from "@rgrove/parse-xml";
import { DiagramOutputError } from "./errors.js";

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
 * @throws {DiagramOutputError} On the first failed assertion (code OUTPUT_INVALID,
 *         exit 4); `detail` names the assertion that failed.
 */
export function assertOutputValid(svg: string): void {
  const doc = assertWellFormed(svg); // parse once, reuse the tree
  assertTier2(svg);
  assertStructural(svg, doc);
  assertFontPortable(svg);
  assertA11y(doc);
}
```

`assertWellFormed` returns the parsed document so the structural and a11y checks
reuse the tree rather than re-parsing. `parseXml`'s return type is
`import("@rgrove/parse-xml").Document` (verified export: the package's default API
is `parseXml(xml: string, options?): Document`, throwing on malformed input).

### 3.2 `assertWellFormed`

```typescript
import { parseXml, type XmlDocument } from "@rgrove/parse-xml";

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
```

> **WARNING:** confirm `@rgrove/parse-xml` exports `XmlDocument` as a named type. If
> the installed version names it `Document` instead, import that name. Verify before
> implementing — the package was not present in `node_modules` at spec time.

### 3.3 `assertTier2` (proves REQ-OUT-01)

```typescript
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
```

### 3.4 `assertStructural` (REQ-OUT-02)

```typescript
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
```

> `XmlElement.attributes` is `Record<string, string>` in `@rgrove/parse-xml`. Verify
> the accessor name (`root.attributes`) against the installed version before
> implementing.

### 3.5 `assertFontPortable` (REQ-OUT-04)

```typescript
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
export function assertFontPortable(svg: string): void {
  if (/@import\b/.test(svg) || /url\(\s*["']?https?:/i.test(svg)) {
    throw new DiagramOutputError(
      "rendered SVG references an external font/URL; fonts must be embedded (REQ-OUT-04)",
      "assertFontPortable",
    );
  }
  const hasEmbeddedFace =
    /@font-face\b[^}]*\bsrc\s*:[^}]*url\(\s*["']?data:/is.test(svg);
  if (!hasEmbeddedFace) {
    throw new DiagramOutputError(
      "rendered SVG has no embedded data-URI @font-face; text would not be portable (REQ-OUT-04)",
      "assertFontPortable",
    );
  }
}
```

### 3.6 `assertA11y` (REQ-A11Y-01)

```typescript
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
    throw new DiagramOutputError(
      'root <svg> is missing role="img" (REQ-A11Y-01)',
      "assertA11y",
    );
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
    if (child.type === "element") {
      if (child.name === name) return true;
      if (hasDescendant(child, name)) return true;
    }
  }
  return false;
}
```

> `@rgrove/parse-xml` node discrimination uses `node.type === "element"` and
> `XmlElement.children`. Verify the `type` discriminant string and `children`
> accessor against the installed version.

---

## 4. REQ-IN-03 — "MUST NOT invent semantic content" is NOT machine-validatable (v1)

REQ-IN-03 ("the skill MUST NOT invent semantic content the user did not describe")
is a **prompt-discipline constraint**, not a property of the artifact. No schema or
output assertion can distinguish a node the user asked for from one the agent
imagined — both are valid `DiagramSpec` entries. Per tech-spec §3.2, this is
enforced by **SKILL.md authoring guidance** ("depict only what the user described"),
not by code in `validate.ts`. v1 ships no machine check for REQ-IN-03; the
authoring guidance lives in `05-cli-and-invocation.md` §4 (natural-language mode).
This document records the decision so the gap is explicit, not accidental.

See `05-cli-and-invocation.md` §4 for the SKILL.md guidance that discharges REQ-IN-03.

---

## 5. Diagram input JSON Schema generation — `schema-gen.ts` (REQ-DISC-03 analog, REQ-IN-02)

`schemas/diagram-input.schema.json` is the committed JSON Schema for the
engine-neutral input, generated from the Zod `DiagramSpec`. Per tech-spec §3.2, the
existing `src/schema-gen.ts` is **not parameterized** (it hardwires `Manifest` and a
single output path), so this is a **sibling generator** that mirrors that file's
shape exactly — reusing only the `zodToJsonSchema` import. Do not refactor
`src/schema-gen.ts`; do not import it.

`src/diagram/schema-gen.ts`:

```typescript
#!/usr/bin/env bun
/**
 * schema-gen.ts — JSON-Schema generation & drift guard for the diagram input spec.
 *
 * Sibling of the repo-root src/schema-gen.ts (which hardwires the Manifest; not
 * parameterized — tech-spec §3.2). Mirrors that file's pattern exactly: a pure
 * builder over the Zod `DiagramSpec` source of truth (00 §2.4) plus a side-effectful
 * CLI that either WRITES the committed schema or, with `--check`, regenerates in
 * memory and diffs against the committed file (exit non-zero on drift). Wired into
 * `gate` via `schema:check:diagram` (01 §5). Reuses ONLY the `zodToJsonSchema`
 * import from `zod-to-json-schema`.
 *
 * Usage:
 *   bun run src/diagram/schema-gen.ts            # regenerate + write the committed schema
 *   bun run src/diagram/schema-gen.ts --check    # drift guard: fail if the committed copy is stale
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { DiagramSpec } from "./schema.js";

/** Committed JSON Schema output path (relative to repo root). Single committed copy. */
export const DIAGRAM_SCHEMA_OUTPUT_PATH = "schemas/diagram-input.schema.json" as const;

/**
 * Build the diagram-input JSON Schema OBJECT from the Zod `DiagramSpec` source of
 * truth (00 §2.4). Pure: no filesystem, no clock — safe to call from both the writer
 * and the drift check, guaranteeing they compare identical values.
 *
 * Uses `$refStrategy: "none"` so the schema is fully inlined (matches the manifest
 * generator). Key order is deterministic: zod-to-json-schema emits keys in a stable
 * order for a fixed Zod input, and the metadata keys ($schema/$id/title/description)
 * are appended in fixed order — so two calls yield byte-identical JSON when
 * serialized.
 *
 * Note: the cross-field `superRefine` (§2) is NOT representable in JSON Schema; the
 * generated document captures per-field shape only. Cross-field invariants are a
 * runtime check (parseSpec, §2.4). This is documented in `description` so consumers
 * of the JSON Schema are not surprised.
 *
 * @returns The JSON Schema as a plain object.
 */
export function buildDiagramSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(DiagramSpec, { $refStrategy: "none" }) as Record<
    string,
    unknown
  >;
  schema["$schema"] = "http://json-schema.org/draft-07/schema#";
  schema["$id"] = "diagram-input.schema.json";
  schema["title"] = "Diagram Generator Input Spec";
  schema["description"] =
    "Engine-neutral DiagramSpec for the diagram-generator skill (REQ-IN-02). " +
    "Per-field shape only; cross-field referential/type-agreement invariants are " +
    "enforced at runtime (02-schema-and-validation.md §2), not in this schema.";
  return schema;
}

/**
 * Build the diagram-input JSON Schema TEXT: the object from {@link buildDiagramSchema}
 * serialized as pretty-printed JSON (2-space indent) with a trailing newline so the
 * committed file is POSIX-clean and byte-stable. This is what gets written/diffed.
 *
 * @returns The pretty-printed JSON Schema text (2-space indent, trailing newline).
 */
export function buildDiagramSchemaJson(): string {
  return JSON.stringify(buildDiagramSchema(), null, 2) + "\n";
}

// ─── CLI entry (side-effectful: skipped on import) ──────────────────

if (import.meta.main) {
  const repoRoot = resolve(import.meta.dirname, "..", "..");
  const check = process.argv.includes("--check");
  const output = buildDiagramSchemaJson();
  const abs = resolve(repoRoot, DIAGRAM_SCHEMA_OUTPUT_PATH);

  if (check) {
    // Drift guard: regenerate in memory, diff against the committed file.
    const current = existsSync(abs) ? readFileSync(abs, "utf-8") : "";
    if (current !== output) {
      console.error(
        `Diagram schema drift: ${DIAGRAM_SCHEMA_OUTPUT_PATH} differs from the Zod source.\n` +
          `Run: bun run schema:gen:diagram   (then commit the result)`,
      );
      process.exit(1);
    }
    console.log("Diagram input schema is in sync with the Zod source.");
    process.exit(0);
  }

  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, output);
  console.log(`Generated ${DIAGRAM_SCHEMA_OUTPUT_PATH}`);
}
```

**Differences from `src/schema-gen.ts` (all intentional):**

- `repoRoot = resolve(import.meta.dirname, "..", "..")` — this file is one level
  deeper (`src/diagram/`), so it walks up twice, not once.
- Imports `DiagramSpec` from `./schema.js`, not `Manifest`.
- Output path, `$id`, `title`, `description`, and the regenerate-command hint are
  diagram-specific.

Everything else — `$refStrategy: "none"`, draft-07, the pure builder split, the
`+ "\n"` trailing newline, the `--check` diff-or-write branch, `import.meta.main`
guard — is byte-for-byte the same pattern, so the gate behaves identically (01 §5).

---

## Dependencies

- `00-core-definitions.md` — `DiagramSpec`, `Node`, `Edge`, `Container`,
  `Participant`, `Message`, `DiagramType` (types); `DiagramInputError`,
  `DiagramOutputError`, `EXIT_CODES` (errors); used by §2, §3, §5.
- `01-architecture-layout.md` — module placement (`src/diagram/validate.ts`,
  `src/diagram/schema-gen.ts`), import graph (§3), and the `schema:gen:diagram` /
  `schema:check:diagram` / `gate` script wiring (§5).
- `03-rendering-engine.md` — owns producing the SVG that §3 validates and owns
  REQ-OUT-01 (this doc only *asserts* it); `render.ts` calls `assertOutputValid`.
- `04-theme-postprocess-png.md` — `svg-postprocess.ts` injects the data-URI
  `@font-face` (§3.5) and the `<title>`/`<desc>`/`role="img"` (§3.6) that these
  assertions check.
- `05-cli-and-invocation.md` — calls `parseSpec` (Stage 1) and surfaces
  `DiagramInputError`/`DiagramOutputError` to stderr with the mapped exit codes;
  owns the REQ-IN-03 authoring guidance (§4).
- External packages: `@rgrove/parse-xml` (XML well-formedness, §3.2–§3.6),
  `zod` (refine context, §2), `zod-to-json-schema` (schema generation, §5; reused
  import only).

## Verification

- [ ] `parseSpec` rejects an edge referencing a missing node with `INPUT_INVALID`
      (exit 2) and `detail` names path `edges.N.to`.
- [ ] `parseSpec` rejects a container child / `parent` referencing a missing id.
- [ ] `parseSpec` rejects a `Message.from`/`to` referencing a missing participant.
- [ ] `parseSpec` rejects duplicate ids within `nodes`, `containers`, and
      `participants`, each pathed at the second occurrence.
- [ ] `parseSpec` rejects a node id and container id that collide.
- [ ] `parseSpec` rejects a `flowchart` spec with empty `nodes` and a `sequence`
      spec with non-empty `nodes`/`edges`/`containers` (00 §2.5 table).
- [ ] A valid architecture spec and a valid sequence spec each pass `parseSpec`.
- [ ] All cross-field violations in one input surface together (single pass).
- [ ] `assertWellFormed` throws `DiagramOutputError` on malformed XML.
- [ ] `assertTier2` throws when `<foreignObject>` is present and when no `<text>`
      is present; passes a clean tier-2 SVG.
- [ ] `assertStructural` throws on missing `viewBox`/`width`/`height` and on a
      malformed (non-4-number) `viewBox`.
- [ ] `assertFontPortable` throws on an external font URL / `@import` and on a
      missing embedded data-URI `@font-face`; passes an embedded-face SVG.
- [ ] `assertA11y` throws on missing `role="img"`, `<title>`, or `<desc>`.
- [ ] `assertOutputValid` throws on the first defect and returns normally for a
      fully valid SVG; on throw, `render.ts` writes no artifact (REQ-REL-01).
- [ ] `bun run src/diagram/schema-gen.ts` writes
      `schemas/diagram-input.schema.json` (draft-07, inlined `$refStrategy: "none"`).
- [ ] `bun run src/diagram/schema-gen.ts --check` exits 0 in sync, non-zero on
      drift; `buildDiagramSchemaJson()` ends with a single trailing newline and is
      byte-stable across two calls.
- [ ] `schema:check:diagram` is wired into `gate` and stays green (01 §5).
- [ ] REQ-IN-03 has no machine check; the decision and the cross-ref to
      `05-cli-and-invocation.md` §4 are documented (§4).
