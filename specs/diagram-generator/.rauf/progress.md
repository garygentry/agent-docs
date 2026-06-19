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
