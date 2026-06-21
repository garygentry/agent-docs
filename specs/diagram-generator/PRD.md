# Diagram Generator — Product Requirements Document

> Slug: `diagram-generator` · Stage: forge-1-prd v1 · Source research: `.reference/research.md`

## 1. Problem Statement

Features in this ecosystem need diagrams generated from text — most immediately
the `doc-site-plugin` generator, whose docs sites want theme-aware SVG diagrams
as build inputs (never hand-edited), and more broadly any feature or engineer who
wants an architecture or flow diagram without hand-placing pixels or standing up a
rendering service.

Today there is no shared, reliable way to turn a text description into a portable
diagram artifact. Ad-hoc approaches either render client-side (browser-only,
fails outside a browser), depend on heavy runtimes or hosted services, or emit
SVGs that break when opened in Inkscape/Office/PDF pipelines. The result is
inconsistent, non-portable diagrams and duplicated effort across features.

We want a single `diagram-generator` skill that takes a text description and emits
a self-contained, portable diagram artifact, usable both conversationally by an
engineer and as a deterministic build step by other tools (notably
`doc-site-plugin`). The design research already exists; this PRD specifies the
requirements that skill must satisfy.

## 2. User Stories

- **As an engineer**, I want to describe a system or flow in plain text and get a
  clean diagram artifact, so that I can document architecture without drawing it
  by hand.
- **As an engineer who wants precise control**, I want to supply a structured
  spec instead of prose, so that the diagram reflects exactly the nodes, edges,
  and containers I specify.
- **As a docs author**, I want the emitted SVG to open correctly everywhere
  (browser, Inkscape, Office, LaTeX, PDF), so that my diagrams are portable
  across the tools my team uses.
- **As the `doc-site-plugin` build step**, I want to invoke diagram generation
  non-interactively and get artifacts at known paths, so that diagrams can be
  regenerated every build as inputs rather than hand-edited assets.
- **As a reader using assistive technology**, I want diagrams to carry
  accessible titles/descriptions, so that screen readers convey their meaning.
- **As a tool author in this repo**, I want the skill authored once in
  Claude-native form and emitted to all five agent targets, so it behaves
  consistently regardless of which coding agent invokes it.

## 3. Functional Requirements

### 3.1 Input

- **REQ-IN-01** (P0): The skill MUST accept a **natural-language** description of
  the diagram and infer its structure (nodes, edges, containers, grouping).
- **REQ-IN-02** (P0): The skill MUST also accept a **structured specification**
  supplied directly by the user, for precise control, as an alternative to prose.
  This specification is an **engine-neutral schema** (nodes, edges, containers,
  grouping) whose concrete shape is defined in the tech spec — it is NOT the
  underlying rendering engine's native DSL. This keeps the input decoupled from
  the engine choice (OQ-2) and consistent with REQ-USE-01 (no DSL required).
- **REQ-IN-03** (P0): The skill MUST NOT invent semantic content the user did not
  describe; it depicts what it is told, not an imagined architecture.

### 3.2 Diagram Coverage

- **REQ-COV-01** (P0): The skill MUST generate **architecture / box-arrow-flow**
  diagrams (components, containers, connections, legends). Emitted diagrams MUST
  satisfy these inspectable properties: no overlapping component boxes; connection
  arrows routed behind boxes (correct z-order); every label contained within its
  box/boundary; and, when a legend is present, the legend placed outside all
  boundary boxes. Semantic component coloring MUST be applied (component type maps
  to a consistent color).
- **REQ-COV-02** (P0): The skill MUST also generate common diagram types:
  **flowchart, sequence, entity-relationship, state, and data-flow** diagrams
  from the same text-input model.

### 3.3 Output Contract

- **REQ-OUT-01** (P0): The primary artifact MUST be a **self-contained,
  opens-anywhere (tier-2 portable) SVG**: plain `<text>` elements (no HTML
  `<foreignObject>`), so it displays identically in browsers, Inkscape, Office,
  LaTeX, and PDF pipelines.
- **REQ-OUT-02** (P0): Every emitted SVG MUST declare an explicit `viewBox` plus
  width/height and use absolute, well-formed coordinates.
- **REQ-OUT-03** (P0): The skill MUST also produce a **PNG** rasterization at build
  time as a standard v1 artifact (a universal fallback for non-SVG destinations),
  alongside the SVG. (The doc-site-plugin consumer path uses the SVG; PNG serves
  destinations that cannot embed SVG.)
- **REQ-OUT-04** (P0): The output MUST contain **no runtime renderer and no
  view-time network dependency** — no client-side rendering library, no CDN
  fonts or scripts. Fonts MUST be a system-stack or embedded/subsetted so the
  artifact is fully offline-portable.

### 3.4 Reliability

- **REQ-REL-01** (P0): Before emitting, the skill MUST **validate** that the
  artifact is well-formed and renderable (parse/structural check).
- **REQ-REL-02** (P0): On validation failure the skill MUST **fail loudly** with a
  clear error rather than emit a broken artifact. (Automatic self-correction/retry
  is NOT required for v1 — see OQ-1.)

### 3.5 Theming & Accessibility

- **REQ-THEME-01** (P0): The skill MUST support **light and dark** variants and a
  **configurable accent/brand color**, so diagrams match the theme of the
  consuming docs site.
- **REQ-A11Y-01** (P0): Emitted SVGs MUST include `<title>`, `<desc>`, and
  `role="img"` so they are screen-reader accessible.

### 3.6 Invocation & Integration

- **REQ-INV-01** (P0): The skill MUST support **conversational invocation** — an
  engineer asks their coding agent to produce a diagram from a description.
- **REQ-INV-02** (P0): The skill MUST support **non-interactive / scriptable
  invocation** that produces artifacts deterministically at caller-specified
  output paths, so build steps can call it. Both modes are required for v1.
- **REQ-INV-03** (P0): The scriptable path MUST be **consumable by builds** —
  notably `doc-site-plugin`'s prebuild diagram step (REQ-DIAG-02/03 / CON-05 of the
  doc-site-plugin PRD). Its contract surface MUST cover all four dimensions the
  consumer depends on: (a) the accepted **input** form(s) for non-interactive use,
  (b) **caller-specified output paths** and the **artifact formats** produced
  (SVG, and PNG per REQ-OUT-03), (c) which **diagram types** (REQ-COV-01/02) are
  invocable non-interactively, and (d) unambiguous **exit / success-failure**
  signaling. (The precise schema, argument shape, naming, and exit codes are
  finalized in the tech spec; see OQ-3.)
- **REQ-INV-04** (P0): The scriptable invocation contract (REQ-INV-03) MUST be a
  **documented, stable interface** that downstream consumers may depend on. Its
  input form, output-path semantics, artifact formats, and exit codes constitute a
  published contract; a breaking change to any of them requires an explicit
  version bump so consumers (e.g. `doc-site-plugin`) can pin against a known
  release.

## 4. Non-Functional Requirements

### 4.1 Portability

- **REQ-PORT-01** (P0): Emitted artifacts MUST be portable across viewers without
  modification (the tier-2 property of REQ-OUT-01/04), and MUST render with no
  network access.
- **REQ-PORT-02** (P0): The skill's procedure MUST be agent-agnostic so it behaves
  equivalently when invoked through any of the five supported coding agents.

### 4.2 Security / Safety

- **REQ-SEC-01** (P0): The skill MUST write only to its intended output path(s)
  and MUST NOT write outside the location the caller specifies.
- **REQ-SEC-02** (P0): Generation MUST NOT require transmitting the input or
  output to any external rendering service; emitted artifacts MUST fetch nothing
  at view time.

### 4.3 Reproducibility

- **REQ-REPRO-01** (P1): Given the same structured-spec input, regeneration SHOULD
  produce a stable artifact suitable for committing and diffing as a build input
  (acknowledging LLM non-determinism for prose input; see Caveats).

### 4.4 Usability

- **REQ-USE-01** (P0): The conversational path MUST keep simple diagrams simple —
  a short prose description should yield a usable diagram without the user
  learning a DSL.

## 5. Constraints

- **CON-01**: The skill is authored as a **canonical tool in this repo**
  (`agent-docs`) under `skills/diagram-generator/`, registered in
  `tools.manifest.json`, and emitted to all five agent targets (Claude, Codex,
  Copilot, Cursor, Gemini) via the existing `bun run build` pipeline.
- **CON-02**: The skill is a **shared dependency**: `doc-site-plugin` consumes it
  for diagram generation (doc-site-plugin REQ-DIAG-02 / CON-05). Its scriptable
  contract must be stable enough for that consumer to depend on.
- **CON-03**: The design research of record is `.reference/research.md`; the
  chosen approach must honor its hard portability constraint (no runtime renderer;
  plain-`<text>` SVG for opens-anywhere output).

## 6. Out of Scope

- **OOS-01**: Cloud-provider branded icon sets (AWS/GCP/Azure/K8s icon diagrams).
- **OOS-02**: Interactive or animated diagrams; any client-side JS in output.
- **OOS-03**: Editing or round-tripping existing diagrams/images back into the
  skill's model (v1 generates from text only).
- **OOS-04**: Authoring the diagram's semantic content — the user supplies what to
  depict.

## 7. Open Questions

- **OQ-1**: Reliability is "validate + fail loudly, no auto-retry" for v1
  (REQ-REL-02). Do we add a compile/self-correct loop in a later version if
  failure rates warrant it?
- **OQ-2**: Generation strategy and engine (text-DSL-to-SVG vs direct-SVG;
  D2 / Graphviz / hand-built) and the resulting **build-time dependency
  footprint** are deferred to the tech spec. This decision determines portability
  details and the consumer contract shape (REQ-INV-03). Constraint on the decision:
  the chosen engine MUST NOT force users to author in its native DSL — the
  engine-neutral schema of REQ-IN-02 sits in front of it (REQ-USE-01).
- **OQ-3**: Exact scriptable invocation contract finalized in the tech spec, across
  the four dimensions of REQ-INV-03 — (a) input form, (b) output paths + artifact
  formats, (c) invocable diagram types, (d) exit/success-failure codes — plus the
  engine-neutral schema definition (REQ-IN-02). Resolving this closes
  doc-site-plugin's OQ-4.

## 8. Success Criteria

- A natural-language description and an equivalent structured spec each produce a
  valid, well-formed diagram artifact.
- Each supported diagram type (architecture, flowchart, sequence, ER, state,
  data-flow) generates successfully from text.
- An emitted SVG opens and renders correctly in a browser AND in at least one
  non-browser viewer (e.g. Inkscape) with no missing text or black boxes — proving
  the tier-2 portability property.
- An emitted SVG renders with no network access (no CDN fetches) and carries
  `<title>`/`<desc>`/`role="img"`.
- Light and dark variants with a configured accent color both render correctly.
- The scriptable path produces artifacts at caller-specified paths and is invoked
  successfully by a `doc-site-plugin` prebuild step, against the documented stable
  contract (REQ-INV-03/04) across all four contract dimensions.
- A malformed/invalid generation is caught by validation and reported, not
  emitted.
- Regenerating from an unchanged structured (engine-neutral) spec produces a
  stable, diff-clean artifact (REQ-REPRO-01).
- The skill is authored once in this repo, emits to all five agent targets via
  `bun run build`, and behaves equivalently regardless of which target invokes it
  (REQ-PORT-02).
