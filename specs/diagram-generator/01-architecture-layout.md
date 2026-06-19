# 01 — Architecture & Layout

How the `diagram-generator` feature is structured in the `agent-docs` repo: the
`src/diagram/` render tree (typechecked, linted, unit-tested with the rest of the
repo), the committed skill bundle that travels to every target, the new
`package.json` dependencies and scripts, and the module import graph. Every other
document references this layout for file placement and import paths.

## Requirement Coverage

| REQ ID | Requirement | Section |
| --- | --- | --- |
| CON-01 | Authored as a canonical skill, emitted to all 5 targets | 1, 2, 5 |
| CON-02 | Shared dependency — stable scriptable contract | 2.2 |
| REQ-OUT-04 | No view-time network; fonts embedded | 4 (bundled assets) |
| REQ-INV-02 | Scriptable, zero-install bundle | 2.2, 3 |
| REQ-PORT-02 | Agent-agnostic — same procedure on every target | 2.1, 5 |
| REQ-REPRO-01 | Deterministic build of the committed bundle | 3, 6 |

## 1. Directory tree (full)

```
agent-docs/
├── src/
│   └── diagram/                     # render source — internal to this repo
│       ├── schema.ts                # DiagramSpec Zod + types + constants     (00 §2,§6)
│       ├── errors.ts                # error hierarchy + EXIT_CODES            (00 §5)
│       ├── validate.ts              # input superRefine + output assertions   (02 §2,§3)
│       ├── dot-emit.ts              # DiagramSpec → Graphviz DOT              (03 §2)
│       ├── graph-render.ts          # DOT → SVG via @viz-js/viz               (03 §2)
│       ├── sequence-svg.ts          # direct-SVG sequence layout              (03 §3)
│       ├── theme.ts                 # palette + light/dark tokens + accent    (04 §2)
│       ├── svg-postprocess.ts       # color/z-order/legend/a11y/font/canon    (04 §3)
│       ├── png.ts                   # SVG → PNG via @resvg/resvg-js           (04 §4)
│       ├── render.ts                # orchestration: spec → RenderResult      (03 §5)
│       ├── schema-gen.ts            # DiagramSpec Zod → JSON Schema + drift    (02 §4)
│       ├── cli.ts                   # arg parse, IO, exit codes, --version    (05 §2,§3)
│       ├── assets/
│       │   └── font.subset.ts       # base64 data-URI subset font (generated) (04 §3)
│       ├── schema.test.ts
│       ├── validate.test.ts
│       ├── dot-emit.test.ts
│       ├── graph-render.test.ts
│       ├── sequence-svg.test.ts
│       ├── theme.test.ts
│       ├── svg-postprocess.test.ts
│       ├── png.test.ts
│       ├── render.test.ts
│       ├── cli.test.ts
│       ├── determinism.test.ts                                                # (08 §4)
│       └── __golden__/              # committed golden SVGs, per type+theme    (08 §2)
│           ├── architecture.light.svg
│           ├── architecture.dark.svg
│           └── … (one per type × {light,dark})
│
├── skills/
│   └── diagram-generator/           # canonical skill (CON-01)
│       ├── SKILL.md                 # procedure + NL-mode authoring guidance   (05 §4)
│       ├── references/
│       │   ├── schema-guide.md      # human-readable DiagramSpec + examples
│       │   └── diagram-craft.md     # color taxonomy, z-order, legend, spacing
│       └── scripts/
│           └── diagram-render.mjs   # COMMITTED single-file bundle (WASM+font inlined) (03 §6)
│
├── schemas/
│   ├── tools.manifest.schema.json   # existing
│   └── diagram-input.schema.json    # NEW: generated from src/diagram/schema.ts (02 §4)
│
├── tools.manifest.json              # +1 ToolEntry for the skill               (06 §2)
└── package.json                     # +devDeps, +scripts                       (§4,§5)
```

The split mirrors the existing repo discipline: real TypeScript lives under `src/`
where `tsc`, ESLint, Prettier, and Vitest already cover it; the **bundle** is the
only artifact that ships into `skills/…/scripts/` and out to every target.

## 2. Build & deployment model

### 2.1 Source vs. bundle vs. emitted (REQ-PORT-02, CON-01)

Three stages, each with its own integrity gate:

1. **Source** (`src/diagram/*.ts`) — authored, typechecked, tested. Not shipped.
2. **Bundle** (`skills/diagram-generator/scripts/diagram-render.mjs`) — produced by
   `bun build` from `src/diagram/cli.ts`, inlining `@viz-js/viz` (WASM, base64),
   `@resvg/resvg-js`, the XML parser, and the subset font. **Committed.** A drift
   guard (`build:diagram:check`, §5) re-bundles in memory and fails CI if the
   committed copy is stale — exactly the pattern `schema-gen.ts --check` and the
   adapter tree already use.
3. **Emitted** (`adapters/<target>/…`) — `bun run build` copies the skill (including
   its `scripts/` bundle, **mode preserved**) verbatim into each of the five target
   trees. No transform touches `.mjs` (verified: `src/publish.ts:118-119` copies
   verbatim with `statSync(...).mode & 0o777`). See `06-integration-and-packaging.md`
   §3 for the per-target relpaths.

### 2.2 Zero-install consumer path (REQ-INV-02, CON-02)

Because the bundle is self-contained (WASM + font inlined, no `node_modules`
needed), a consuming repo — notably `doc-site-plugin`'s prebuild — runs
`bun skills/diagram-generator/scripts/diagram-render.mjs <spec.json> …` (or the
adapter-relative path) with **zero install**. This is the linchpin of the stable,
shared contract (CON-02); the contract surface is frozen in
`05-cli-and-invocation.md` §2 and versioned via `CONTRACT_VERSION` (`00` §6).

## 3. Module export structure & import graph

`src/diagram/` is internal; it exposes **no public package export** (the repo's
`src/index.ts` is unchanged). The only consumer-facing entry point is the CLI
bundle. Internal import direction (acyclic):

```
schema.ts ─┬─────────────► validate.ts ──┐
           ├──► dot-emit.ts ──► graph-render.ts ─┐
           ├──► sequence-svg.ts ───────────────── ┼─► render.ts ─► cli.ts
errors.ts ─┘    theme.ts ─► svg-postprocess.ts ──┘        ▲
                png.ts ───────────────────────────────────┘
schema.ts ─► schema-gen.ts   (standalone generator, not imported by cli.ts)
```

- `schema.ts` and `errors.ts` (`00`) are leaves everyone imports.
- `cli.ts` is the bundle entry (`bun build --target=node src/diagram/cli.ts`).
- `schema-gen.ts` is a standalone script (run by `schema:gen:diagram`), **not**
  part of the CLI bundle — keeps `zod-to-json-schema` out of the shipped `.mjs`.

## 4. Dependencies

New dependencies are **devDependencies only** — they are bundled into the committed
`.mjs`, so consuming repos never install them (REQ-OUT-04 portability; tech-spec
§6/§9). Current runtime deps (`zod`, `zod-to-json-schema`, `yaml`, `smol-toml`) are
unchanged; `zod` is reused for `DiagramSpec`.

| Package | Kind | Purpose |
| --- | --- | --- |
| `@viz-js/viz` | devDep (bundled), **pinned** | Graphviz-WASM layout → plain-`<text>` SVG (03 §2). Pin required for determinism (OTQ-6). |
| `@resvg/resvg-js` | devDep (bundled), **pinned** | SVG → PNG in-process (04 §4, REQ-OUT-03). Pin bounds PNG drift (OTQ-5). |
| `@rgrove/parse-xml` | devDep (bundled) | output XML well-formedness check (02 §3). |
| subset font asset | bundled asset | a libre sans (e.g. DejaVu Sans / IBM Plex subset) embedded as base64 data-URI (04 §3, REQ-OUT-04). |
| `zod` | existing runtime | `DiagramSpec` schema (reused, `00`). |
| `zod-to-json-schema` | existing runtime | generate `diagram-input.schema.json` (02 §4). |

> **Pin policy:** `@viz-js/viz` and `@resvg/resvg-js` are pinned to exact versions
> (no `^`) because their output bytes feed the determinism test (08 §4) and the PNG
> smoke test (08 §5). Exact versions are chosen in `06-integration-and-packaging.md`
> §5 / `04-theme-postprocess-png.md` §4.

## 5. package.json changes

Add to `scripts` (existing `gate` is extended, not replaced):

```jsonc
{
  "scripts": {
    // … existing …
    "build:diagram": "bun build src/diagram/cli.ts --target=node --minify --outfile skills/diagram-generator/scripts/diagram-render.mjs",
    "build:diagram:check": "bun run src/diagram/build-check.ts",   // re-bundle in memory, diff committed (06 §4)
    "schema:gen:diagram": "bun run src/diagram/schema-gen.ts",
    "schema:check:diagram": "bun run src/diagram/schema-gen.ts --check",
    "gate": "bun run compile && bun run schema:check && bun run schema:check:diagram && bun run typecheck && bun run lint && bun run format:check && bun run test && bun run build:check && bun run build:diagram:check"
  }
}
```

- `build:diagram` produces the committed bundle; run after any `src/diagram/`
  change, then commit the `.mjs`.
- `gate` gains two checks — diagram schema drift and bundle drift — so a stale
  committed schema or bundle fails CI exactly like the manifest schema and adapter
  tree do today. Exact wiring (and whether `build-check.ts` is a script vs. an
  inline `bun build --compile` diff) is detailed in `06-integration-and-packaging.md`
  §4.

> Note: `@resvg/resvg-js` ships a native binding. `bun build --target=node`
> bundles the JS and references the platform `.node` binary; the bundle strategy
> (inline vs. resolve-at-runtime for the native addon) is pinned in
> `04-theme-postprocess-png.md` §4 — it is the one place the "fully self-contained"
> claim needs care, and the spec there states the chosen approach explicitly.

## 6. Build/compiler configuration

- TypeScript: inherits the repo `tsconfig.json` (ESM, `"type": "module"`, strict).
  No diagram-specific compiler options.
- The bundle target is `node` (Bun-compatible) so the same `.mjs` runs under both
  Bun and Node in consuming repos.
- Determinism (REQ-REPRO-01): the committed bundle must be byte-stable for a fixed
  toolchain + pinned deps; the `build:diagram:check` drift guard owns bundle bytes
  (per OTQ-1 resolution in `06` §4 — goldens assert relpath presence, not bundle
  bytes).

## Dependencies

- `00-core-definitions.md` — all types/constants placed in this tree.
- The existing emitter pipeline (`src/discover.ts`, `src/publish.ts`,
  `src/targets/_shared.ts`) — unchanged; relied upon to emit the skill verbatim
  (`06-integration-and-packaging.md` §3).

## Verification

- [ ] `src/diagram/` contains every module in §1 and they typecheck (`tsc --noEmit`).
- [ ] `bun run build:diagram` writes `skills/diagram-generator/scripts/diagram-render.mjs`.
- [ ] The committed `.mjs` runs standalone with no `node_modules`
      (`cd /tmp && bun /abs/path/diagram-render.mjs spec.json --out-dir .`).
- [ ] `bun run build` emits the skill (SKILL.md + references + scripts) into all
      five `adapters/<target>/` trees with `.mjs` mode preserved.
- [ ] `bun run gate` runs both new checks and stays green.
- [ ] New deps are in `devDependencies`, not `dependencies`.
