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

## Item 008 — theme.ts (done)
- `src/diagram/theme.ts`: transcribed 04 §1–2 verbatim. Exports `RoleColors`, `ResolvedPalette`, and `resolveTheme(theme, accent?)`. `ResolvedPalette` lives HERE (internal render-only type), not in schema.ts (00 only fixes the KEYS).
- Light/dark `PALETTES` table holds the exact §2.1/§2.2 hex values; `roles` map is total over all 11 NodeRole keys.
- Accent override (§2.3): sets `accent`, `edge`, and `roles.default.stroke` only — semantic role fills stay stable. Omitted accent → variant defaults (light `#2563eb`, dark `#60a5fa`).
- `structuredClone` returns a deep copy so the frozen source is never mutated; `resolveTheme` is pure, never throws.
- 6 tests pass; tsc clean.

## Item 009 — svg-postprocess.ts (done)
- `src/diagram/svg-postprocess.ts`: `postProcess(rawSvg, opts)` per 04 §3. Resolves palette internally via `resolveTheme(opts.theme, opts.accent ?? opts.spec.accent)` — callers pass a theme, not a palette.
- APPROACH: parse-xml gives a read tree; I convert it to a private mutable `SNode` tree (element/text), run all 7 passes on that, and serialize ONCE with a custom minifying serializer. Full control over determinism (attr order, coord rounding, whitespace) and lets me build new elements as plain objects (no XmlElement construction).
- Conversion DROPS comments/PIs/CDATA and any pre-existing `<title>`/`<desc>` (graphviz emits per-node `<title>` metadata) — then injects fresh a11y title/desc. Output is `<svg>…</svg>` only (XML decl/doctype discarded).
- DRAW PARENT: graphviz wraps drawing in `<g class="graph" transform=...>`; sequence draws directly under `<svg>`. `findDrawParent` returns the graph g if present else root. Color baking + z-order operate on the draw parent's element children; legend/backdrop/title/desc/defs go on the ROOT (untransformed user space) so legend lands in the expanded right margin.
- Root child order after passes: `[title, desc, defs(font), backdrop, drawing, legend]` — satisfies BOTH "title/desc first two children" AND "backdrop first DRAWING element" (defs paints nothing).
- Z-order bands (back→front): other(graphviz backdrop polygon) → containers → edges → nodes(role-). Within-band order preserved → deterministic. Sequence header `g.role-*` go to node band (on top); other sequence primitives to `other`.
- COLOR: role groups → shape fill/stroke from palette.roles, text fill=role.text; preserve explicit `fill="none"`. containers → boundary stroke + fill=none + `stroke-dasharray="6 4"`. edges → path stroke=edge, polygon/polyline fill+stroke=edge. graphviz `fill="white"` backdrop recolored to background.
- LEGEND: non-default roles only, emitted when ≥1 present, ordered by palette role-key order. Expands viewBox WIDTH (+gutter+colWidth) and HEIGHT if needed; group appended last.
- FONT (§3.6): `<defs><style>@font-face{…src:url(<FONT_SUBSET_DATA_URI>) format("woff2")}</style></defs>`; style text emitted RAW (CSS, not escaped). Every `font-family` rewritten to `DiagramSans`. Matches validate.ts `assertFontPortable` regex.
- CANONICALIZATION (last): drop unreferenced ids / renumber referenced→e-N + rewrite aria-labelledby/href/url(#); round geometry attrs via `canonNumberTokens`; attrs in ATTR_PRIORITY then lexicographic; fully minified; text collapsed except title/desc preserved; empty elements self-closed. `canonNumber`=round-half-to-even to SVG_COORD_PRECISION, strip trailing zeros/dot.
- Byte-determinism CONFIRMED across runs. width/height set numeric (graphviz emits `pt`; overwritten with viewBox dims).
- slug derived from spec.title (lowercase, non-alnum→`-`, trim, fallback "diagram") — no shared slug helper existed; render.ts (011) can reuse this shape.
- 11 tests; full suite 255 pass; tsc clean. Completed in one iteration.

## Item 010 — png.ts (done)
- `src/diagram/png.ts`: `renderPng(svg, opts?)` per 04 §4. Returns `Uint8Array` PNG bytes; default scale 2 (`DEFAULT_PNG_SCALE`), `fitTo:{mode:"zoom",value:scale}`.
- ENGINE DISCREPANCY: 04 §4.1 prefers the WASM build `@resvg/resvg-wasm` (inlinable for bundle 014), but item 001 actually pinned the NATIVE `@resvg/resvg-js@2.6.2` (that's what's installed + what the title/AC name). Implemented against `@resvg/resvg-js`. Contract is identical (svg string → Uint8Array, failures → DiagramPngError). If the bundle (014) needs WASM for portability, the swap is isolated to the import + a memoized `initWasm`. Native build has NO `initWasm`, so the §4.2 memoization note does not apply here.
- `@resvg/resvg-js` API: `new Resvg(svg, opts)` exposes `.width`/`.height` (intrinsic SVG px); `.render()` → `RenderedImage` with `.asPng():Buffer` and `.width`/`.height` (raster px). Set `font.loadSystemFonts:false` — the SVG embeds its own subset font (§3.6).
- Dimension assertion (§4.3): expected = round(intrinsic × scale); `Math.abs(actual-expected) <= 2` per axis, else DiagramPngError.
- resvg DOES throw synchronously in `new Resvg(...)` on malformed SVG (e.g. `<not-svg/>`, `<svg this is not valid`) — wrapped as DiagramPngError. Test reads PNG IHDR (bytes 16–23) for raster dims rather than decoding.
- 4 png tests; full suite 259 pass; tsc clean.

## Item 011 — render.ts (done)
- `src/diagram/render.ts`: `render(spec, opts: RenderOptions)` transcribed verbatim from 03 §5. Single options object `{ theme, accent? }`. Async (awaits renderGraph for the graph path).
- Dispatch: `sequence` → `renderSequence` (sync, supplies width/height); else `emitDot` → `await renderGraph` (passes width=height=0; postProcess derives authoritative dims from the graphviz SVG).
- postProcess opts `{ theme, accent: opts.accent ?? spec.accent, spec, width, height }`; `accent` falls back to spec.accent. assertOutputValid runs AFTER postProcess; on failure DiagramOutputError propagates and nothing returned.
- RenderResult dims/slug come from postProcess (single dimension owner, REQ-OUT-02). slug e.g. "Web App" → "web-app".
- No input re-validation (REQ-REL-01) — render trusts the typed spec; CLI (012) owns parseSpec. No png import (PNG is CLI's job).
- render.test.ts: all 6 types render end-to-end & pass assertOutputValid; light/dark distinct; width/height match svg attrs; parseSpec rejects bad spec (DiagramInputError); malformed output → DiagramOutputError. 13 tests; full suite 272 pass; tsc clean.

## Item 012 — cli.ts (done)
- `src/diagram/cli.ts`: `parseArgs`, `resolveOutputPaths`, `readInput`, `writeArtifact`, `main(argv): Promise<number>`, transcribed from 05 §2–3. Imports limited to schema/errors/validate(parseSpec)/render/png — no schema-gen/build-check (stay out of bundle).
- `parseArgs`: hand-rolled; VALUE_FLAGS consume next token. enum flags validated via `DiagramType/Theme/HexColor.safeParse`. `--version` short-circuits the input-required + output-conflict checks. Conflicts (out-file+out-dir/out-name; out-name w/o out-dir; two inputs; unknown flag) → DiagramUsageError(64).
- `--type` override applied to the RAW JSON object BEFORE `parseSpec`, so a disagreeing `--type` (e.g. sequence vs a nodes-bearing spec) fails as DiagramInputError via cross-field validation (§2.2), not silently.
- JSON.parse failure wrapped as DiagramInputError (exit 2). parseSpec takes the already-parsed object (validate.ts:246 `parseSpec(raw: unknown)`).
- Output order: resolve ALL format targets first (so png→stdout DiagramUsageError fires before any write), then write svg then png. For `both`, svg writes before png renders → matches "single variant never half-written; png failure leaves the already-written svg".
- `resolveOutputPaths(args,result,format)` precedence out-file > out-dir+out-name > out-dir+slug > stdout. `withExtension` swaps/appends ext. png→stdout throws DiagramUsageError.
- `writeArtifact(root, dest, bytes)`: confinement = `resolve(dest) === resolve(root) || startsWith(root+sep)`, checked BEFORE mkdir/writeFile; escape → DiagramIoError(6). Root = dirname(out-file) for out-file, else resolve(out-dir).
- Top-level runner guarded by `if (import.meta.main)` (same as schema-gen.ts) so the test suite can import without executing; top-level await is fine in ESM.
- TEST GOTCHA: spying `process.stdout.write` with `mockImplementation` — annotate the impl as `(chunk: string|Uint8Array)=>boolean` and cast `as typeof process.stdout.write`; a bare `(chunk: unknown)` impl fails tsc against write's overloads. stdin faked via `Readable.from([...])` + `Object.defineProperty(process,'stdin',...)`.
- 34 cli tests; full suite 306 pass; tsc clean.

## Item 014 — Bundle + build-check + byte golden (done)
- BLOCKER RESOLVED: `bun build` with png.ts importing the NATIVE `@resvg/resvg-js` fails ("cannot write multiple output files without an output directory") because the native `.node` addon emits extra outputs. Per 04 §4.1 (OTQ-5, authoritative) the engine MUST be the WASM build `@resvg/resvg-wasm`. Specs 01/06 still say resvg-js (stale) — 04 §4.1 wins.
- Added devDep `@resvg/resvg-wasm@2.6.2` (kept native `@resvg/resvg-js` too — item 001 invariant; now unused but harmless).
- New generated asset `src/diagram/assets/resvg-wasm.ts` — base64 of `index_bg.wasm` (~3.15MB b64) → `RESVG_WASM_BYTES: Uint8Array`. Regenerate via `bun run src/diagram/assets/gen-resvg-wasm.ts`.
- Rewrote png.ts: `import { initWasm, Resvg } from "@resvg/resvg-wasm"`; memoized `ensureWasm()` (module-level `let wasmInited`) calls `initWasm(RESVG_WASM_BYTES)` once/process (§4.2). `Resvg` is a const, type via `InstanceType<typeof Resvg>`; `.asPng()` returns `Uint8Array` (not Buffer). API contract identical to native build.
- Bundle: `bun run build:diagram` → 9.17MB self-contained .mjs. Verified standalone from /tmp (svg-only AND `--format both` PNG) with no node_modules.
- `src/diagram/build-check.ts`: transcribed 06 §4.2. `buildBundleText(repoRoot)` uses `Bun.build({...}).outputs[0]!.text()` (the `!` for noUncheckedIndexedAccess). `Bun.build` output byte-matches `bun build --outfile`, so drift guard exits 0 when current, 1 when stale.
- GOTCHA: `Bun` global is undefined under vitest/node runtime — the in-memory rebuild check can ONLY run as the `bun run build:diagram:check` CLI (in gate), NOT in a vitest test. So `build-check.test.ts` only byte-compares committed bundle vs the byte golden; the rebuild-parity is the gate's CLI job.
- Byte golden (06 §4.3, OTQ-1): committed `src/diagram/__bundle_golden__/diagram-render.mjs` (a 2nd copy) + `build-check.test.ts` byte-compares it to the shipped bundle. Decoupled from the EMISSION golden tree (src/test/__golden__/<target>/) which needs manifest+SAMPLE_RELPATHS registration = item 015. golden.test.ts only walks per-TARGET dirs so `__bundle_golden__` and a `bundle/` sibling are ignored by it.
- Prettier: added `skills/diagram-generator/scripts/` + `src/diagram/__bundle_golden__/` to `.prettierignore` (minified, can't be formatted).
- ESLint: `*.mjs` → `**/*.mjs` (flat-config glob only matched root before) + ignore `src/diagram/__bundle_golden__/`, else eslint lints the minified .mjs (257 phantom errors).
- PRE-EXISTING lint debt (NOT fixed, out of 014 scope): `svg-postprocess.ts:153` prefer-const on minX/minY (item 009 destructure with reassigned vbW/vbH). gate's `lint` step will need this fixed by item 015 (which requires gate green) or a cleanup pass.
- When the bundle legitimately changes: `bun run build:diagram` THEN `cp skills/diagram-generator/scripts/diagram-render.mjs src/diagram/__bundle_golden__/diagram-render.mjs` in the same commit.

## Item 015 — Manifest ToolEntry + emission to 5 targets (done)
- Appended ONE ToolEntry `{name,type:skill,source:skills/diagram-generator,description}` to tools.manifest.json `tools[]`; Manifest `config` block untouched (§2.2).
- KEY EMITTER FINDING (§5.4 governs): `emit()` splits output — TRANSFORMED files (SKILL.md→per-target shape + gemini aggregate) go in `result.files`; a skill's VERBATIM owned subtree (`references/*`, `scripts/diagram-render.mjs`) goes in `result.verbatim`, NOT `result.files`. `golden.test.ts` only asserts `result.files`. So SAMPLE_RELPATHS gets ONLY the per-target SKILL relpath (claude/codex `skills/diagram-generator/SKILL.md`, gemini `…/diagram-generator.md`, copilot `instructions/diagram-generator.instructions.md`, cursor `rules/diagram-generator.mdc`). The spec §5.3's refs/scripts/.mjs goldens were written assuming verbatim folds into files — it does NOT; §5.4 ("actual emitter output is source of truth") wins. refs/scripts/.mjs bytes + executable mode are pinned by the whole-tree `build:check` against committed `adapters/<target>/`, plus `build:diagram:check` — the two-places-that-move-together (OTQ-1) still holds.
- Added `src/test/__golden__/` to `.prettierignore` (emitted artifacts; byte-stability owned by golden.test, like `adapters/`).
- Cleared the deferred gate debt: prefer-const fix at svg-postprocess.ts:153 (split `let [minX,minY,vbW,vbH]` → const minX/minY + let vbW/vbH from init vars), and `prettier --write .` cleared repo-wide format debt (specs, src/diagram, skill md). Prettier reformatting src/diagram/*.ts SHIFTED the minified bundle bytes → had to `bun run build:diagram` + `\cp -f` to `__bundle_golden__/` + `bun run build` (re-emit adapters). NOTE: `cp` is aliased to `cp -i`; use `\cp -f` in non-interactive scripts.
- Regen order after any skill-source/format change: build:diagram → cp golden → build (adapters) → regenerate-goldens.ts → gate.
- `bun run gate` fully green (307 tests, schema:check:diagram + build:diagram:check included).

## Item 017 — Property + determinism + PNG smoke tests (done)
- Added 3 cross-cutting test files (no new production module): `property.test.ts`, `determinism.test.ts`, `png-smoke.test.ts`.
- `property.test.ts`: reuses the 003 validators VERBATIM (assertOutputValid + each of assertWellFormed/Tier2/Structural/FontPortable/A11y) over all 12 goldens (08 §4.2); architecture §4.3 props; theme+accent §4.4.
- GOTCHA (§4.3 z-order regex): the spec's `/class="node"/` / `/class="edge"/` literals DON'T match — postProcess emits `class="node role-backend"` (role appended). Use `/class="node[\s"]/` and `/class="edge[\s"]/`. Confirmed via `grep -o 'class="[^"]*"'` on a golden.
- `determinism.test.ts` (§5): two in-process renders byte-equal (incl width/height) for all 6 types + each render matches its committed golden for all 12 type×theme.
- `png-smoke.test.ts` (§6): renders architectureFixture via render.ts then renderPng; asserts PNG magic + dims = intrinsic×2 within ±2px. Named `png-smoke` to avoid clashing with item 010's existing `png.test.ts` (the §6 filename is taken).
- Full suite 414 pass; tsc clean.

## Item 018 — CLI contract tests + emission/gate guard (done)
- Item 012 already authored `cli.test.ts` (per-flag unit coverage). Item 018 adds the CONTRACT-level half in two NEW files rather than rewriting:
  - `src/diagram/cli-contract.test.ts` (19 tests): §7.4 every `--type` over shared `FIXTURES` + `--format svg|png|both`; per-class `DiagramError`→`EXIT_CODES` mapping table (all 6 classes); OUTPUT_INVALID proven at the validator boundary (synthetic `<foreignObject>` → `assertOutputValid` throws DiagramOutputError, exit 4 — render never emits one, per 08 §7.4 note); §7.5 `--version`; §7.6 path confinement; §7.7 in-process vs committed-bundle parity (spawn `bun <bundle.mjs>` via execFileSync, byte-compare SVG to `main()` output — identical).
  - `src/test/emission-guard.test.ts` (11 tests): §8 REQ-PORT-02 — emits the manifest and asserts the diagram-generator SKILL transform lands in every target's `result.files` (via SAMPLE_RELPATHS) AND the verbatim bundle `.mjs` lands in every target's `result.verbatim`.
- GOTCHA (emission guard): the verbatim bundle relpath is RELOCATED per target — claude/codex/gemini `skills/diagram-generator/scripts/diagram-render.mjs`, copilot `instructions/diagram-generator/scripts/…`, cursor `rules/diagram-generator/scripts/…`. Match by leaf suffix (`diagram-generator/scripts/diagram-render.mjs`), not a fixed `skills/` prefix.
- architectureFixture title is "Web Service" → slug `web-service` (cli.test.ts's local fixture is "Web App" → `web-app`); naming assertions differ between the two files accordingly.
- Full suite 444 pass (was 414); `bun run gate` green (exit 0, incl. schema:check:diagram + build:diagram:check).
