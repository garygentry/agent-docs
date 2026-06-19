# Progress Log — diagram-generator

## Item 001 — Scaffold (done)
- New devDeps pinned exact: `@viz-js/viz` 3.28.0, `@resvg/resvg-js` 2.6.2, `@rgrove/parse-xml` 4.2.0.
- Scripts added: build:diagram, build:diagram:check, schema:gen:diagram, schema:check:diagram; `gate` extended with schema:check:diagram + build:diagram:check.
- `src/diagram/assets/font.subset.ts` exports `FONT_SUBSET_DATA_URI` — a real subset of DejaVu Sans (ASCII printable + common punctuation/arrows), compiled to WOFF2 (~15.6KB) and base64-embedded as `data:font/woff2;base64,...`.
  - Regeneration: `pip install fonttools brotli`, then `fontTools.subset` over `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf` with `options.flavor="woff2"`, populate `text=` the glyph set, zero `head.created/modified` for determinism.
- `bun install` for the new devDeps NOT run in this iteration (criteria only need package.json entries + tsc); later items that import these (006/009/010) will need an install.
- Only `tsc --noEmit` is expected to pass at this stage; `gate` references scripts (build-check.ts, schema-gen.ts, cli.ts) created by later items.

## Item 002 — Core definitions (done)
- `src/diagram/schema.ts`: transcribed 00 §2–6 verbatim — enums, Node/Edge/Container/Participant/Message, `DiagramSpec.strict()`, `RenderResult`, `DiagramErrorCode`, and constants (CONTRACT_VERSION, EXIT_CODES, DEFAULT_FORMAT, DEFAULT_THEME, SVG_COORD_PRECISION). NodeId is module-private (not exported) per spec.
- EXIT_CODES + DiagramErrorCode live in schema.ts; `errors.ts` imports them (`./schema.js`) and defines the DiagramError base + 6 subclasses.
- Import extension convention is `.js` (moduleResolution: bundler) — matches src/*.ts.
- Cross-field invariants deliberately NOT here — they live in validate.ts (item 003).
- 13 tests pass; tsc --noEmit clean.

## Item 003 — validate.ts (done)
- `src/diagram/validate.ts`: transcribed 02 §2–3. Input: `diagramSuperRefine`, `GRAPH_DIAGRAM_TYPES`, `parseSpec`. Output: `assertOutputValid` aggregator + individually exported `assertWellFormed`/`assertTier2`/`assertStructural`/`assertFontPortable`/`assertA11y` (kept exported for reuse by render.ts/017).
- schema.ts keeps the BASE `.strict()` schema (no superRefine attached). `parseSpec` applies the refine via a module-local `RefinedDiagramSpec = DiagramSpec.superRefine(diagramSuperRefine)` then `.safeParse`. Avoids the 02 §2.1 import cycle while satisfying item 003's "parse then apply refine" wording.
- `@rgrove/parse-xml` v4.2.0 API confirmed: exports `parseXml`, `XmlDocument`, `XmlElement`; `.root` (XmlElement|null), `.name`, `.attributes` (Record<string,string>), `.children`. The `.type` getter returns plain `string` (NOT a literal union) so it does NOT narrow TS — use `child instanceof XmlElement` (import XmlElement as a VALUE) for the descendant DFS.
- Had to run `bun install` (item 001 deferred it) — the three devDeps now resolved in the lockfile.
- TEST GOTCHA: vitest `toThrow(/re/)` matches `error.message`, NOT `error.detail`. JSON paths live in `DiagramInputError.detail`, so assert paths via a `detailOf()` helper, not the regex form of toThrow.
- `assertStructural(svg, doc)` has an unused `svg` param (matches spec signature); tsc passes because `noUnusedParameters` is off (only `strict: true`).
- 39 validate tests pass; full suite 211 pass; tsc clean.

## Item 004 — schema-gen.ts (done)
- `src/diagram/schema-gen.ts`: transcribed 02 §5 verbatim. `repoRoot = resolve(import.meta.dirname, "..", "..")` (two levels up since file is in src/diagram/). Reuses ONLY `zodToJsonSchema`; imports `DiagramSpec` from `./schema.js`.
- Generated/committed `schemas/diagram-input.schema.json` (draft-07, `$refStrategy: "none"`, 2-space + trailing newline). `--check` diffs in-memory regen vs committed; exit 0 in sync, exit 1 + drift message on stale.
- Standalone: not imported anywhere (cli.ts not yet created); guarded by `import.meta.main`.
- tsc clean.

## Item 005 — dot-emit.ts (done)
- `src/diagram/dot-emit.ts`: `emitDot(spec)` per 03 §2. Pure/deterministic; throws `DiagramRenderError` for sequence + defensive dangling-id guards (edges, container children, container parent).
- Tier-2: only quoted `label="…"`, never `label=<…>` / `shape=record`. Role carried as `class="role-<role>"` (default `role-default`); NO fillcolor/style=filled (deferred to 009).
- `TYPE_DEFAULTS` per diagramType: rankdir (LR/TB), defaultShape (state→rounded), defaultEdgeDir (er→none else forward). Node.shape overrides via `SHAPE_MAP`.
- Containers → `subgraph "cluster_<id>" { label; class="container"; <children nodes>; <nested clusters by parent> }`. Top-level nodes (not in any container.children) emitted after clusters in spec.nodes order. Node ids quoted everywhere → dashes safe; cluster names quoted too.
- Escaping: `\`→`\\`, `"`→`\"`, newline→`\n`. Output ends with trailing `\n`.
- 15 dot-emit tests; full suite 226 pass; tsc clean.

## Item 006 — graph-render.ts (done)
- `src/diagram/graph-render.ts`: `renderGraph(dot)` per 03 §3.2 verbatim. Memoized `getViz()` caches the `@viz-js/viz` instance for the process.
- `@viz-js/viz` 3.28.0 API confirmed against `node_modules/@viz-js/viz/types/index.d.ts`: `instance(): Promise<Viz>`; `Viz.renderString(input, options?: RenderOptions): string` — DOES throw on render failure (unlike `render()` which returns a FailureResult). So the spec's try/catch → DiagramRenderError pattern works as written with `{ format: "svg", engine: "dot" }`.
- Graphviz output is byte-identical across calls for identical DOT in-process (test asserts byte-equality). Cross-run determinism still relies on 04 canonicalization, but within a process it's stable.
- Graphviz emits an XML/doctype preamble before `<svg>`; tests slice from `<svg` to assert the root element.
- 4 graph-render tests; full suite 230 pass; tsc clean.

## Item 007 — sequence-svg.ts (done)
- `src/diagram/sequence-svg.ts`: `renderSequence(spec)` per 03 §4. Pure/deterministic, no async, no IO. Returns `{svg,width,height}`.
- Layout constants transcribed verbatim from §4.2; geometry per §4.3. Running y-cursor (`rowY[]`) accumulates self-message extra height so dimensions match the §4.3 formula exactly (verified: 3 participants/4 messages/1 self-msg → 488×328).
- Arrow styles (§4.4): sync→filled `<polygon>` arrowhead (`arrowhead-closed`), async/reply→open `<polyline>` (`arrowhead-open`), reply line gets `stroke-dasharray`. Arrowheads drawn as explicit primitives, NOT `<marker>`/`<defs>`.
- Activation bars (§4.5): emitted after lifelines, before arrows (z-order). Span = activating row → next matching `reply` from the activated target, else one MESSAGE_ROW_HEIGHT.
- Self-message: polyline loop (out/down/back) + left-pointing arrowhead at lifeline; consumes MESSAGE_ROW_HEIGHT+SELF_MESSAGE_EXTRA.
- Participant role carried as `class="role-<role>"` on header `<g>` (mirrors dot-emit §2.5); no color baked (deferred to 009).
- Output is pre-a11y/pre-font raw SVG (has viewBox/width/height; no <title>/<desc>/role=img yet — those are svg-postprocess 009's job).
- GOTCHA: `noUncheckedIndexedAccess` is on — `rowY[m]`/`messages[k]` are `T | undefined`; cast with `as number`/`as Message` where index validity is structurally guaranteed.
- New text escaping helper `escapeXml` (&,<,>,") — distinct from dot-emit's `escapeDot`; SVG/XML grammar, not DOT grammar.
