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
