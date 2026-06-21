# Battle-Tested "Skills" and Approaches for AI-Generated Architecture Diagrams

## TL;DR

- **Build your skill around a text-DSL-to-SVG compiler — specifically D2 (terrastruct/d2, 24.4k GitHub stars, latest release v0.7.1, MPL-2.0) or Graphviz/DOT — as the primary engine, because the agent generates reliable text that a build-time CLI compiles to a self-contained SVG with no runtime renderer.** For the _prompting patterns_ themselves, the single best reference implementation to study and adapt is the **Cocoon-AI `architecture-diagram` SKILL.md** (Cocoon-AI/architecture-diagram-generator, 5.5k stars / 412 forks, MIT, v1.1) — the most explicit, practitioner-grade skill file for boxes-text-arrows architecture diagrams.
- **Avoid Mermaid for the display artifact**: it renders client-side and its SVG export uses HTML `<foreignObject>`, so the file only displays correctly in a browser — it fails your hard "no-runtime-renderer" requirement (mermaid-cli can render at build time, but the resulting SVG still breaks in Inkscape/Office/PDF pipelines).
- **One critical SVG caveat applies to nearly every option**: even build-time SVGs that _embed HTML/foreignObject_ (Mermaid, and to a degree D2) are "web-context only." If you need a truly portable SVG that opens anywhere (Inkscape, Illustrator, Office, LaTeX), prefer engines that emit **plain `<text>` elements** (Graphviz, hand-written SVG, the `svg-precision` JSON→SVG approach) or post-process to embed fonts/flatten foreignObject.

## Key Findings

1. **There is no single "official" Anthropic diagram skill** for software architecture. Anthropic's `anthropics/skills` repo (152k stars / 18k forks; "Public repository for Agent Skills") ships creative/visual skills — `algorithmic-art` (p5.js → self-contained HTML), `canvas-design` (→ PNG/PDF), `frontend-design`, `theme-factory`, `web-artifacts-builder`, `mcp-builder`, `skill-creator` — but **none is dedicated to architecture/box-and-arrow diagrams**. The most relevant Anthropic artifacts are the _meta_ skill (`skill-creator`) and the prompting conventions inside `algorithmic-art`/`canvas-design`.
2. **The strongest purpose-built community skill** is **Cocoon-AI/architecture-diagram-generator** (5.5k stars / 412 forks, MIT, v1.1, by Cocoon AI, PBC) — a Claude skill whose `SKILL.md` is an unusually complete recipe for architecture diagrams (semantic color palette by component type, JetBrains Mono typography, explicit spacing/overlap math, arrow z-ordering, legend placement, viewBox sizing). Its header reads: _"Create professional technical architecture diagrams as self-contained HTML files with inline SVG graphics and CSS styling."_ It outputs a **single self-contained HTML file with inline SVG** and no JS required to render.
3. **For deterministic, portable output**, the `svg-precision` skill (by dkyazzentwatwa) models the "generate a strict JSON scene-graph → build SVG → validate → optionally render PNG with CairoSVG" loop — a strong pattern for direct-SVG generation with validation.
4. **Diagram-as-code engines split cleanly on the runtime/portability axis:**
   - **Graphviz/DOT** — emits clean standalone SVG with plain `<text>`; opens anywhere; oldest and most battle-tested (initiated by AT&T Bell Labs; the DOT language was detailed in Koutsofios & North, "Drawing graphs with dot," Technical Report 910904, AT&T Bell Laboratories, Murray Hill, NJ, September 1991; licensed under the Eclipse Public License); weaker default aesthetics.
   - **D2** — best modern layout/aesthetics for architecture; README confirms _"D2 currently supports SVG, PNG and PDF exports"_ at build time, but its SVG embeds CSS + `<foreignObject>` + fonts → "meant to be viewed in a web context."
   - **mingrammer `diagrams`** (Python, 42.3k stars, latest v0.25.1; _"It uses Graphviz to render the diagram"_) — beautiful cloud-icon architecture diagrams, but **SVG output is effectively broken** (references local filesystem icon paths); PNG is the reliable artifact. Used in production by Apache Airflow's documentation.
   - **PlantUML** — broad UML coverage, SVG/PNG, requires Java at build time.
   - **Mermaid** — huge ecosystem (88,672 stars; created 2014 by Knut Sveidqvist; Mermaid Chart Inc. raised a $7.5M seed round in March 2024 from Sequoia, Microsoft M12, and Open Core Ventures), but runtime-rendered by default and its foreignObject SVGs are browser-only.
5. **MCP servers exist but mostly violate the constraint or add a service dependency**: AWS Diagram MCP (awslabs, now **deprecated** in favor of a diagram agent skill in the deploy-on-aws plugin), draw.io MCP, Mermaid MCP (Puppeteer/headless Chrome), Kroki (a rendering _service_). These are convenient but not "self-contained skill" material.

## Details

### A. Anthropic's official skills landscape

The canonical repo is **github.com/anthropics/skills**. Its example skills demonstrate Anthropic's house style for visual generation but target art, not architecture:

- **`algorithmic-art`**: two-step "create a computational philosophy (.md) → express it in p5.js" producing a **self-contained interactive HTML artifact** with seeded randomness and parameter sliders. Key transferable pattern: _separate the "design philosophy/spec" step from the "generation" step_, and _keep a template fixed while replacing only the algorithm_.
- **`canvas-design`**: produces `.png`/`.pdf` "art objects" via a design-philosophy-first approach.
- **`skill-creator`**: Anthropic's meta-guidance — emphasizes (a) starting from 2-3 concrete use cases, (b) "pushy" descriptions to improve triggering, (c) progressive disclosure (lean SKILL.md + `references/`, `scripts/`, `assets/`), and (d) running eval queries (mix of should-trigger / should-not-trigger) to tune the `description`.
- Anthropic also notes the document skills are **point-in-time snapshots, not actively maintained** — reference examples, not dependencies.

Anthropic's broader "Artifacts" feature renders SVG and Mermaid **client-side in the browser** — useful for iteration, but not a self-contained file unless you extract the SVG/HTML.

### B. The best reference skill files to study and adapt

**1. Cocoon-AI `architecture-diagram` (recommended primary reference for prompting).**
Its `SKILL.md` is the clearest battle-tested encoding of "boxes + text + flows" know-how I found. Concrete techniques it codifies:

- **Semantic color system by component type** (frontend cyan `#22d3ee`, backend emerald, database violet, AWS amber, security rose, message bus orange) with rgba fills + stroke pairs.
- **Arrow z-order rule**: "Draw connection arrows early in the SVG (after the background grid) so they render behind component boxes. SVG elements are painted in document order." Plus an opaque-mask-rect trick to stop arrows showing through semi-transparent boxes.
- **Explicit anti-overlap math**: standard component height 60px, minimum 40px vertical gap, place message-bus connectors centered in the gap; worked examples of "wrong vs right" coordinates.
- **Legend-placement rule**: legends must sit _outside_ all boundary boxes; compute the lowest boundary's `y+height` and place the legend ≥20px below, expanding the viewBox height to fit.
- **Output contract**: a single self-contained `.html` with embedded CSS, inline SVG, no external images, no JS — "renders correctly when opened directly in any modern browser." (Caveat: it uses an html2canvas/jsPDF export toolbar via CDN, and notes `foreignObject` renders inconsistently in html2canvas — "stick to plain `<svg>` shapes and `<text>`.")

**2. `svg-precision` (recommended reference for deterministic direct-SVG).**
Models the **spec-then-build-then-validate** loop: turn the request into a strict **Spec JSON scene graph**, run `svg_cli.py build spec.json out.svg`, then `validate`, then optionally `render` a PNG via CairoSVG. Its design rules are excellent prompt guardrails: always set `canvas.viewBox` + explicit width/height; prefer absolute coordinates; round numbers to 3-4 decimals (no NaN/inf); put reusable items (markers, gradients, clipPaths) in `<defs>`; default diagram canvas 1200×800; and "text varies by fonts/viewers… treat text as a risk and prefer shapes" for pixel-identical results.

**3. Houtini / Gemini-MCP SVG write-up** — practitioner guidance for direct-SVG: set viewBox dimensions in the prompt ("680x300 viewBox"); use `<g>` groupings and CSS custom properties for theming; add `<title>`/`<desc>` + `role="img"` for informative diagrams; keep files as human-editable XML ("SVG treated as code," avoid AI "node soup").

### C. Engine-by-engine evaluation against your constraints

| Approach                             | Self-contained, no runtime renderer? | SVG quality / portability                                | Build-time deps                       | Reputability                                 | Arch-diagram fit (shapes+text+flows)                                     |
| ------------------------------------ | ------------------------------------ | -------------------------------------------------------- | ------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------ |
| **Graphviz / DOT**                   | ✅ Yes — static SVG/PNG              | ✅ Plain `<text>`, opens anywhere                        | Graphviz binary                       | AT&T Bell Labs, DOT spec 1991; EPL           | Good for graphs; dated styling, no cloud icons                           |
| **D2 (terrastruct)**                 | ✅ Build-time SVG/PNG/PDF            | ⚠️ SVG embeds CSS+foreignObject+fonts → web-context only | single Go binary, no Java/Node        | 24.4k stars, v0.7.1, MPL-2.0, active         | **Best modern layout** for architecture (containers, nesting, ELK/dagre) |
| **mingrammer `diagrams`**            | ⚠️ PNG yes; SVG broken               | ❌ SVG references local icon paths                       | Python + Graphviz                     | 42.3k stars, v0.25.1; used by Apache Airflow | Excellent cloud-icon architecture (PNG only)                             |
| **PlantUML**                         | ✅ Build-time SVG/PNG                | ✅ Reasonable SVG                                        | Java (JRE)                            | Enterprise standard since 2009               | Strong UML/sequence/component                                            |
| **Mermaid (mmdc build-time)**        | ⚠️ Static file possible              | ❌ foreignObject → browser-only                          | Node + headless Chrome (Puppeteer)    | 88,672 stars; largest ecosystem              | Good flowcharts/sequence; weak node positioning, no cloud icons          |
| **Hand-written SVG (svg-precision)** | ✅ Fully self-contained              | ✅ Full control, plain text                              | Python + CairoSVG (optional, for PNG) | Pattern, not a product                       | Full control but error-prone at scale                                    |
| **Excalidraw → SVG**                 | ✅ Static SVG                        | ⚠️ Needs font embedding to be portable                   | Node/Playwright (headless)            | Popular hand-drawn aesthetic                 | Good for sketchy diagrams                                                |
| **Kroki**                            | ❌ It's a rendering _service/API_    | depends on backend engine                                | self-host server or use kroki.io      | Popular unifier (MIT)                        | Unifies 25+ engines, but adds a service                                  |

### D. The runtime-vs-build-time distinction, precisely

- **Mermaid**: by default renders in the browser at _display_ time (the page ships mermaid.js, ~370-480KB, which builds the SVG live) → fails the hard requirement. **mermaid-cli (mmdc)** _can_ produce a static SVG/PNG at build time (via headless Chrome/Puppeteer), which removes the _display-time_ dependency — BUT the emitted SVG uses HTML `<foreignObject>` and `<br>` for text, so it renders correctly only in browsers and breaks (black boxes / missing text / invalid XML) in Inkscape, Office, Batik, prawn-svg, and many PDF pipelines (mermaid issues #2688, #58, #180; workaround: `htmlLabels:false`, or post-process to inject `xmlns`/flatten). Net: build-time Mermaid is acceptable only if the SVG is consumed by a browser.
- **D2**: compiles `.d2 → .svg` at build time with a single Go binary (no service after install). Its SVG is genuinely static, but it injects CSS and uses `<foreignObject>` for Markdown labels and embeds fonts, so it is "meant to be viewed in a web context… may not look right… in Inkscape or Adobe Illustrator." For web docs this is perfect; for Office/print, render to PNG/PDF instead.
- **Graphviz**: build-time SVG with plain `<text>` — the gold standard for a portable, opens-anywhere static SVG. This is why Mermaid's own users cite Graphviz as the reference for "simple text elements" (mermaid issue #2688 requests Mermaid emit text "similar to Graphviz").
- **mingrammer diagrams**: PNG is fully self-contained; the SVG path embeds absolute local file references to icon PNGs (issues #26, #1030) and is not portable — so treat it as a **PNG-only** generator.

### E. Direct-SVG generation vs. text-DSL-to-SVG (the core architectural choice)

- **Direct SVG generation** (agent writes raw `<svg>`, or via a JSON scene-graph like svg-precision, or Python `drawsvg`/`svgwrite`): maximum control over exact shapes, text, and flows; produces the most portable plain-`<text>` SVG; but **error-prone** — coordinate math, overlap avoidance, and arrow routing are all on the model. Mitigate with the Cocoon-AI spacing/z-order rules and a validate step.
- **Text-DSL-to-SVG** (agent writes DOT/D2/PlantUML, a CLI compiles it): far **more reliable and maintainable** — the layout engine handles positioning, diffs are clean in Git, and the agent only has to be correct about _semantics_ (nodes/edges/containers), not pixels. Tradeoff: less pixel control and (for D2/Mermaid) the foreignObject portability caveat. LLMs are strongly trained on DOT/Mermaid/PlantUML/D2 syntax, so generation accuracy is high — but always **compile-and-validate in a loop** (the engines emit parse errors the agent can self-correct against; D2 even parses multiple errors at once).

**Recommendation on this axis:** Use **text-DSL-to-SVG as the default** (D2 for web docs, Graphviz for opens-anywhere portability), and reserve **direct-SVG** for cases needing bespoke shapes/branding the DSLs can't express — using the svg-precision spec-build-validate pattern.

## Recommendations

**Stage 1 — Decide the output contract first (this drives everything):**

- If diagrams live in **web docs / Markdown / a browser**: target **D2 → SVG** (best layout) or HTML+inline-SVG (Cocoon-AI style).
- If diagrams must **open anywhere** (Inkscape, Office, LaTeX, PDF, print): target **Graphviz → SVG** (plain `<text>`), or **render to PNG** as the universal fallback, or hand-built plain-`<text>` SVG via the svg-precision pattern.
- Threshold to switch: if a stakeholder reports "text is missing / boxes are black" when opening your SVG outside a browser, you have a foreignObject problem → move to Graphviz/plain-SVG or ship PNG.

**Stage 2 — Author the SKILL.md by adapting the proven references:**

1. Copy the **structure** from Anthropic `skill-creator`: kebab-case `name`, a "pushy" `description` with explicit trigger words ("architecture diagram, system diagram, data flow, component diagram, infrastructure…"), progressive disclosure (`SKILL.md` + `references/` + `scripts/` + `assets/templates`).
2. Copy the **diagram craft rules** from Cocoon-AI: semantic color-by-component-type palette, arrow z-order, 40px min gaps / overlap math, legend-outside-boundaries, explicit viewBox sizing.
3. Copy the **reliability loop** from svg-precision: spec → build → **validate** → (optional) render PNG; require `viewBox` + explicit width/height; absolute coords; reusable `<defs>`; treat text as a risk.
4. Bundle a **deterministic build script** (e.g., `scripts/render.sh` invoking `d2 in.d2 out.svg` or `dot -Tsvg in.dot -o out.svg`) so the agent runs code rather than hand-placing pixels.

**Stage 3 — Make it vendor-portable:**

- The Agent Skills format (SKILL.md + YAML frontmatter) is an **open standard** — its specification was published December 18, 2025 at agentskills.io, and as of June 2026 its client showcase lists roughly 40 adopters including GitHub Copilot, VS Code, Cursor, OpenAI Codex, Gemini CLI, JetBrains Junie, Goose, OpenCode, Databricks, and Snowflake (alongside Claude Code/Claude.ai/the Claude API). Keep instructions tool-agnostic; put any Claude-specific niceties behind optional sections. For non-skill agents (Aider, older Copilot setups), the same `SKILL.md` doubles as a system-prompt / rules file.
- Keep build-time deps minimal and documented (D2 = one Go binary; Graphviz = one package). Avoid baking in Node+headless-Chrome (Mermaid) or a Kroki service unless you accept that dependency.

**Stage 4 — Add a self-correction loop:** have the agent compile the DSL, read compiler errors, and retry; for direct-SVG, run an XML/structural validator and (optionally) rasterize a PNG preview so the agent can visually check overlaps.

**Benchmarks that would change the recommendation:**

- If you need **cloud-provider icons** (AWS/GCP/Azure/K8s) and PNG output is acceptable → switch primary engine to **mingrammer `diagrams`** (PNG) or the **AWS deploy-on-aws diagram agent skill**.
- If you need **GitHub-native inline rendering** and accept browser-only display → **Mermaid** wins on ecosystem.
- If diagrams exceed ~200 nodes → prefer **D2 with the ELK engine** or Graphviz, which handle large graphs better than Mermaid's dagre.

## Caveats

- **"Self-contained" has two tiers.** A file with no _runtime renderer_ (your hard requirement) is satisfied by any build-time SVG/PNG. But a _portable_ SVG that displays identically everywhere additionally requires plain `<text>` (not foreignObject) and embedded/subsetted fonts. D2 and Mermaid satisfy tier 1 but not tier 2 for non-browser viewers; Graphviz and hand-built plain-SVG satisfy both.
- **Reputability of community skills is modest relative to the engines.** Cocoon-AI (5.5k stars / 412 forks) is well-crafted but young, and svg-precision is newer still (its install count could not be verified from an authoritative source). Treat both as _reference implementations to learn from_, not load-bearing dependencies. The truly battle-tested layer is the underlying **engines** (Graphviz, D2 at 24.4k stars, PlantUML, mingrammer diagrams at 42.3k stars) and the **open Agent Skills standard** itself.
- **mingrammer `diagrams` SVG is not usable** for sharing (local-path icon references; issues #26 and #1030); use its PNG output only.
- **AWS Diagram MCP server is deprecated** as of mid-2026 — AWS now points to a diagram agent skill in its deploy-on-aws plugin; don't build new work on the old MCP server.
- **LLM diagram generation is non-deterministic**; the same prompt won't reproduce identical output, and dense diagrams still need human review. Keep a human-in-the-loop validation step.
- Font embedding for portable SVG can be done at build time with tools like `svgfontembed`/`svgoptim` (subset + base64 data-URI) if you choose D2/Excalidraw and need offline portability.

### Direct links to inspect

- Anthropic skills (canonical): `github.com/anthropics/skills` — see `skill-creator`, `algorithmic-art`, `canvas-design`.
- Cocoon-AI architecture skill: `github.com/Cocoon-AI/architecture-diagram-generator` (see `architecture-diagram/SKILL.md`).
- svg-precision skill: `mcp.directory/skills/svg-precision` → source `github.com/dkyazzentwatwa/chatgpt-skills/tree/main/svg-precision-skill`.
- D2: `github.com/terrastruct/d2`; exports/foreignObject caveat at `d2lang.com/tour/exports`.
- Graphviz: `graphviz.org`. mingrammer diagrams: `github.com/mingrammer/diagrams` + `diagrams.mingrammer.com`.
- Mermaid CLI: `github.com/mermaid-js/mermaid-cli`; foreignObject portability issue: `github.com/mermaid-js/mermaid/issues/2688`.
- Kroki (unified service): `kroki.io`. Agent Skills standard: `agentskills.io`.
- Practitioner write-ups: Houtini "How to Make SVGs with Claude and Gemini MCP"; Paul Simmering "Diagrams as Code: Supercharged by AI Assistants"; "Diagram as Code Comparison" at `diagrams.so`; `text-to-diagram.com`.

## What Cocoon actually is, mechanically

It's a single Claude-optimized `SKILL.md` plus one `resources/template.html`. The output contract is **not a `.svg` file** — it's a self-contained _HTML document_: `<html><head>` (embedded CSS + a Google Fonts `<link>` for JetBrains Mono + two pinned CDN scripts, html2canvas@1.4.1 and jsPDF) `</head><body>` wrapping a header, a `<div class="diagram-container">` holding the inline `<svg>`, summary cards, and a footer. The export toolbar (Copy / PNG / PDF) is baked into every diagram and runs html2canvas client-side.

So three things live in the generated artifact's `<head>` that are network-fetched at view time: the Google Font, and the two CDN scripts. The SVG _shapes and text_ render with zero dependencies, but the intended typography and the export buttons need the network. Against your stated hard requirement ("no runtime dependencies for display"), that's a real — if narrow — violation: the diagram shows offline, but not as designed, and the export path breaks.

It's also **dark-theme only** (`#020617` slate background, grid pattern), single-contributor, v1.1, MIT.

## Where it's genuinely strong (this is what you want)

The _inner SVG discipline_ is excellent and exactly aligned with portability:

- It deliberately uses **plain `<svg>` shapes + `<text>`** and explicitly tells the model to **avoid `foreignObject`** (because html2canvas renders it inconsistently). That's the single most important property for an SVG that opens anywhere — Cocoon arrives at it for the wrong reason (html2canvas), but it's the right constraint.
- The craft rules are the real asset: semantic color-by-component-type palette, font-size ladder (12/9/8/7px), arrow z-ordering (draw connectors early so boxes paint over them), anti-overlap spacing math, security-group/region dashed-boundary conventions, legend-outside-boundaries, viewBox sizing (~1000–1100px wide).

That craft layer is hard-won and would take you many iterations to rediscover. It's the part worth taking.

## Where it mismatches a document-tools repo

The packaging is the opposite of what a docs pipeline wants. A document agent-tools repo wants the tool to **emit a clean `.svg` (or `.png`) artifact** that downstream steps embed into Markdown/MDX/PDF/Word. Cocoon emits an opinionated HTML _app_ with a chrome toolbar, CDN coupling, and a fixed dark theme. You'd spend your effort stripping the wrapper, removing the export scripts, inlining/subsetting the font, and theming — i.e., fighting the output contract on every generation. Adopting it as-is means inheriting a contract you'd immediately have to undo.

It's also Claude-specific in its _delivery_ (zip upload to Claude.ai, Code Execution toggle). The craft content is agent-agnostic, but the "how you ship and invoke it" assumes Claude.ai's skill UI — irrelevant if you're borrowing the content into your own repo.

## Verdict: borrow, don't adopt

For your purpose I'd treat Cocoon as a **reference implementation to mine, not a dependency to vendor.** Concretely:

**Lift** the diagram-craft section nearly verbatim (it's MIT — keep the license/attribution): the color taxonomy, z-order rule, spacing math, font ladder, legend rule, viewBox conventions, and especially the "plain shapes + `<text>`, no foreignObject" constraint.

**Replace** the output contract entirely. Your skill should emit a bare `.svg` (with `viewBox` + explicit width/height, fonts either system-stack or subsetted/embedded as a data-URI so it's offline-portable, no CDN, no toolbar), and optionally rasterize to PNG at build time. Drop html2canvas/jsPDF; if you want PNG/PDF, do it in your build step (CairoSVG/rsvg/resvg) rather than client-side.

**Decide the generation strategy independently.** Cocoon is pure direct-SVG generation, which is fine for the bounded "dark architecture diagram" niche but gets error-prone as diagrams grow. If your repo wants reliability at scale, the craft rules transfer cleanly onto a **D2/Graphviz-compile** path too — you'd keep Cocoon's _semantic_ conventions (what colors/shapes mean) and let the engine own layout. So borrowing from Cocoon doesn't lock you into hand-drawn SVG; it gives you the design language either way.

One honest caveat on reputability: the ~6k stars are real but young and single-contributor, so its _value to you is the prompt craft, not its battle-testing as a component_. The battle-tested layer remains the engines underneath (Graphviz/D2). Treat Cocoon as a very good cheat-sheet for the part those engines don't give you — the opinionated visual semantics.
