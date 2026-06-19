# 08 — Testing Strategy

How the `diagram-generator` feature is **proven** to meet PRD §8. This document
specifies the Vitest suite that backs every success criterion: committed golden
SVGs per diagram type × theme, property assertions reused from `02`'s output
validators, the byte-identity determinism test, a PNG smoke test, the CLI contract
tests against the frozen `05` surface, and the emission/gate guard from `06`. It
is the always-last document in the suite; it depends on every prior one and adds
**no new production module** — only tests, fixtures, golden assets, and one
golden-regeneration script.

The suite runs under the repo's existing test runner — `vitest run` (the
`package.json` `"test"` script, verified at `package.json:20`) — with no new
framework. Test files are co-located in `src/diagram/*.test.ts` (`01 §1`), and the
golden SVGs live in `src/diagram/__golden__/` (`01 §1`). Conventions match the
existing repo suites (`src/test/golden.test.ts`, `src/schema-gen.test.ts`,
`src/test/regenerate-goldens.ts`): `describe`/`it`/`expect` from `vitest`, a
deliberate (never auto-overwriting) golden-regeneration script, and drift-style
assertions wired into `bun run gate`.

## Requirement Coverage

Each row maps a PRD §8 success criterion (and its backing `REQ-XXX-NN`) to the
test section that proves it.

| PRD §8 success criterion | REQ ID(s) | Test section |
| --- | --- | --- |
| Each diagram type renders successfully from text | REQ-COV-01, REQ-COV-02 | 3 (golden), 7.2 (fixtures) |
| Structured spec produces a valid, well-formed artifact | REQ-IN-02, REQ-REL-01 | 3, 4 |
| SVG opens correctly everywhere — tier-2 (`<text>`, no `<foreignObject>`) | REQ-OUT-01 | 4.2 |
| SVG declares explicit `viewBox` + width/height | REQ-OUT-02 | 4.2 |
| SVG renders with no network access; embedded font, no external URL | REQ-OUT-04, REQ-SEC-02 | 4.2 |
| SVG carries `<title>`/`<desc>`/`role="img"` | REQ-A11Y-01 | 4.2 |
| Architecture inspectable properties (semantic color, legend-outside, z-order) | REQ-COV-01 | 4.3 |
| Light and dark variants with accent both render | REQ-THEME-01 | 3, 4.4 |
| Regenerating an unchanged spec is diff-clean (byte-identical) | REQ-REPRO-01 | 5 |
| PNG produced at build time, valid & correctly sized | REQ-OUT-03 | 6 |
| Scriptable path: caller paths, input forms, types, exit codes | REQ-INV-02, REQ-INV-03, REQ-INV-04 | 7 |
| Versioned contract — `--version` prints `CONTRACT_VERSION` | REQ-INV-04 | 7.5 |
| Malformed generation caught by validation, reported not emitted | REQ-REL-01, REQ-REL-02 | 7.4, 4.2 |
| Path confinement — writes only inside the caller's dir | REQ-SEC-01 | 7.6 |
| Skill emits to all five targets; `gate` stays green | REQ-PORT-02 | 8 |

## 1. Test layout & runner

```
src/diagram/
  fixtures.ts            # shared: one minimal valid DiagramSpec per type (§7.2)
  __golden__/            # 12 committed golden SVGs (§2)
    architecture.light.svg   architecture.dark.svg
    flowchart.light.svg      flowchart.dark.svg
    sequence.light.svg       sequence.dark.svg
    er.light.svg             er.dark.svg
    state.light.svg          state.dark.svg
    dataflow.light.svg       dataflow.dark.svg
  regenerate-goldens.ts  # DELIBERATE golden writer (§2.3), mirrors src/test/regenerate-goldens.ts
  golden.test.ts         # render each fixture → compare to committed golden (§3)
  property.test.ts       # property assertions over every golden SVG (§4)
  determinism.test.ts    # byte-identical SVG across two render calls (§5)  (01 §1)
  png.test.ts            # PNG smoke (§6)
  cli.test.ts            # CLI contract: IO, paths, types, exit codes (§7)
```

Plus the **per-module unit tests** already enumerated in `01 §1`
(`schema.test.ts`, `validate.test.ts`, `dot-emit.test.ts`, `graph-render.test.ts`,
`sequence-svg.test.ts`, `theme.test.ts`, `svg-postprocess.test.ts`,
`render.test.ts`) — those are owned by their respective documents' Verification
sections; `08` owns the integration-level golden/property/determinism/PNG/CLI/gate
tests and the shared fixtures.

The emission/gate guard (`§8`) does **not** add a `diagram/`-local test — it
extends the existing `src/test/golden.test.ts` + `SAMPLE_RELPATHS`
(`src/test/golden.shared.ts`) machinery, per `06-integration-and-packaging.md` §3.

## 2. Golden SVGs (REQ-COV-01, REQ-COV-02, REQ-THEME-01)

### 2.1 Scope — 12 committed files

One committed golden per **diagram type × theme**: the six types of REQ-COV-01/02
(`architecture`, `flowchart`, `sequence`, `er`, `state`, `dataflow`) crossed with
`{light, dark}` = **12 files** under `src/diagram/__golden__/`, named
`<type>.<theme>.svg`. Each is produced from the fixed `DiagramSpec` fixture for
that type (`§7.2`) and is the exact, byte-for-byte output of the render pipeline
after the `04 §3` post-process (color + a11y + font + canonicalization). Because the
SVGs are canonicalized (`04 §3.7`, `SVG_COORD_PRECISION` from `00 §6`), they are
byte-stable and safe to commit and diff (REQ-REPRO-01). The bundle `.mjs` is **not**
a golden here — per tech-spec OTQ-1, byte-fidelity of the bundle is owned by
`build:diagram:check`; goldens cover the rendered SVG only.

### 2.2 What the golden proves

A golden diff is the single most readable regression signal: any change to
`dot-emit.ts`, `graph-render.ts`, `sequence-svg.ts`, `theme.ts`, or
`svg-postprocess.ts` that alters output surfaces as a tight, reviewable diff. The
goldens are the artifact form of PRD §8's "each supported diagram type generates
successfully" and "light and dark variants render correctly."

### 2.3 Regeneration script (mirrors `src/test/regenerate-goldens.ts`)

Goldens are **never** auto-overwritten on a plain `vitest run` — exactly the
discipline of the existing emitter golden suite (verified:
`src/test/regenerate-goldens.ts` is a standalone `bun run` script, and
`src/test/golden.test.ts:16` documents "Goldens never auto-update on a plain
`vitest run`"). The diagram suite mirrors this with
`src/diagram/regenerate-goldens.ts`:

```typescript
/**
 * Golden regeneration (08 §2.3) — DELIBERATE, reviewed step. Mirrors
 * `src/test/regenerate-goldens.ts`.
 *
 * Renders every fixture (08 §7.2) in both themes via the SAME `render` (03 §5) the
 * golden test uses and rewrites the 12 byte-exact goldens under
 * `src/diagram/__golden__/`. Goldens are NEVER auto-overwritten on `vitest run`;
 * an unintended render change surfaces as a failing `golden.test.ts` assertion.
 *
 * Run intentionally, then review the diff under `src/diagram/__golden__/`:
 *
 *     bun run src/diagram/regenerate-goldens.ts
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { render } from "./render.js";
import { FIXTURES } from "./fixtures.js";
import { GOLDEN_DIR, GOLDEN_THEMES, goldenFileName } from "./golden.shared.js";

async function main(): Promise<void> {
  fs.mkdirSync(GOLDEN_DIR, { recursive: true });
  let written = 0;
  for (const fixture of FIXTURES) {
    for (const theme of GOLDEN_THEMES) {
      const result = await render(fixture.spec, { theme, accent: fixture.accent });
      const abs = path.join(GOLDEN_DIR, goldenFileName(fixture.spec.diagramType, theme));
      fs.writeFileSync(abs, result.svg);
      written++;
    }
  }
  console.log(`Regenerated ${written} diagram golden(s) under ${GOLDEN_DIR}`);
}

void main();
```

A small `src/diagram/golden.shared.ts` (mirroring `src/test/golden.shared.ts`)
holds the constants both the writer and the test import, so they cannot drift:

```typescript
/** Shared constants for the diagram golden suite (08 §2) and its regenerator. */
import * as path from "node:path";

import type { DiagramType, Theme } from "./schema.js";

/** Committed golden tree: `src/diagram/__golden__`. */
export const GOLDEN_DIR = path.resolve(import.meta.dirname, "__golden__");

/** The two theme variants every type is goldened in (REQ-THEME-01). */
export const GOLDEN_THEMES: readonly Theme[] = ["light", "dark"] as const;

/** Deterministic golden filename: `<type>.<theme>.svg`. */
export function goldenFileName(type: DiagramType, theme: Theme): string {
  return `${type}.${theme}.svg`;
}
```

## 3. Golden comparison test (REQ-COV-01/02, REQ-THEME-01, REQ-IN-02)

`golden.test.ts` renders each fixture in each theme and asserts byte-equality with
the committed golden. Reading goldens with `utf8` and comparing the full string
gives a precise diff on failure.

```typescript
/**
 * Diagram golden suite (08 §3, proves PRD §8 "each type generates successfully"
 * and "light/dark variants render correctly").
 *
 * Renders each fixture (08 §7.2) in both themes via `render` (03 §5) and asserts
 * the output is byte-identical to the committed golden (08 §2). Regenerate
 * deliberately: `bun run src/diagram/regenerate-goldens.ts`.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, it, expect } from "vitest";

import { render } from "./render.js";
import { FIXTURES } from "./fixtures.js";
import { GOLDEN_DIR, GOLDEN_THEMES, goldenFileName } from "./golden.shared.js";

describe("diagram goldens (REQ-COV-01/02, REQ-THEME-01)", () => {
  for (const fixture of FIXTURES) {
    for (const theme of GOLDEN_THEMES) {
      it(`renders ${fixture.spec.diagramType}.${theme} byte-identical to its golden`, async () => {
        const result = await render(fixture.spec, { theme, accent: fixture.accent });
        const abs = path.join(GOLDEN_DIR, goldenFileName(fixture.spec.diagramType, theme));
        const golden = fs.readFileSync(abs, "utf8");
        expect(result.svg).toBe(golden);
      });
    }
  }
});
```

This covers all 12 (type × theme) cases and proves the structured-spec path
(REQ-IN-02) yields a valid artifact for every type.

## 4. Property assertions (REQ-OUT-01/02/04, REQ-A11Y-01, REQ-SEC-02)

Property tests run over **every emitted golden SVG** — the canonical output of the
pipeline — and **reuse `02`'s exported validators verbatim** rather than
re-implementing the checks. This guarantees the test and the production output gate
(`assertOutputValid`, called by `render.ts` at `03 §5`) agree on the contract.

### 4.1 Source of truth — reuse `02`'s validators

The functions under test are the exact exports of `src/diagram/validate.ts`
(`02 §3`):

```typescript
import {
  assertOutputValid,   // 02 §3.1 — aggregator
  assertWellFormed,    // 02 §3.2 — well-formed XML, returns the parsed doc
  assertTier2,         // 02 §3.3 — <text> present, no <foreignObject>
  assertStructural,    // 02 §3.4 — viewBox + width + height
  assertFontPortable,  // 02 §3.5 — embedded data-URI @font-face, no external URL
  assertA11y,          // 02 §3.6 — <title>/<desc>/role="img"
} from "./validate.js";
```

### 4.2 Per-golden property suite

```typescript
/**
 * Output-property assertions over every committed golden SVG (08 §4). Reuses the
 * 02 §3 validators so the test enforces the SAME tier-2/structural/font/a11y
 * contract that `render.ts` gates on at emit time.
 *
 * Proves PRD §8: tier-2 portability (REQ-OUT-01), explicit viewBox+w/h
 * (REQ-OUT-02), no network / embedded font (REQ-OUT-04/REQ-SEC-02), and
 * <title>/<desc>/role="img" (REQ-A11Y-01).
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, it, expect } from "vitest";

import { FIXTURES } from "./fixtures.js";
import { GOLDEN_DIR, GOLDEN_THEMES, goldenFileName } from "./golden.shared.js";
import {
  assertOutputValid,
  assertWellFormed,
  assertTier2,
  assertStructural,
  assertFontPortable,
  assertA11y,
} from "./validate.js";

/** All 12 goldens as { name, svg } for table-driven property checks. */
const GOLDENS = FIXTURES.flatMap((f) =>
  GOLDEN_THEMES.map((theme) => {
    const name = goldenFileName(f.spec.diagramType, theme);
    return { name, svg: fs.readFileSync(path.join(GOLDEN_DIR, name), "utf8") };
  }),
);

describe("golden SVG output properties (REQ-OUT-*, REQ-A11Y-01, REQ-SEC-02)", () => {
  for (const { name, svg } of GOLDENS) {
    describe(name, () => {
      it("passes the full output contract (assertOutputValid)", () => {
        expect(() => assertOutputValid(svg)).not.toThrow();
      });

      it("is well-formed XML", () => {
        expect(() => assertWellFormed(svg)).not.toThrow();
      });

      it("is tier-2: contains <text>, contains no <foreignObject> (REQ-OUT-01)", () => {
        expect(svg).toMatch(/<text[\s>]/);
        expect(svg).not.toContain("<foreignObject");
        expect(() => assertTier2(svg)).not.toThrow();
      });

      it("declares explicit viewBox + width + height (REQ-OUT-02)", () => {
        const doc = assertWellFormed(svg);
        expect(() => assertStructural(svg, doc)).not.toThrow();
        // and a positive sanity check on the literal markup:
        expect(svg).toMatch(/<svg\b[^>]*\bviewBox="[-\d.\s]+"/);
        expect(svg).toMatch(/<svg\b[^>]*\bwidth="/);
        expect(svg).toMatch(/<svg\b[^>]*\bheight="/);
      });

      it("embeds a data-URI font and references no external font/URL (REQ-OUT-04/SEC-02)", () => {
        expect(() => assertFontPortable(svg)).not.toThrow();
        expect(svg).toMatch(/@font-face[^}]*url\(\s*["']?data:/is);
        expect(svg).not.toMatch(/url\(\s*["']?https?:/i);
        expect(svg).not.toMatch(/@import\b/);
      });

      it("carries <title>, <desc>, and role=\"img\" (REQ-A11Y-01)", () => {
        const doc = assertWellFormed(svg);
        expect(() => assertA11y(doc)).not.toThrow();
        expect(svg).toContain("<title");
        expect(svg).toContain("<desc");
        expect(svg).toMatch(/<svg\b[^>]*\brole="img"/);
      });
    });
  }
});
```

The literal-string assertions are a redundant belt-and-braces check alongside the
validator reuse: if `02`'s validator regressed, the raw-markup assertions still
catch the property loss.

### 4.3 Architecture-specific properties (REQ-COV-01) — what is machine-assertable

REQ-COV-01 requires architecture diagrams to satisfy several inspectable
properties. Be honest about which are practically assertable in code vs.
golden-reviewed by a human:

| REQ-COV-01 property | Machine-assertable? | How |
| --- | --- | --- |
| No `<foreignObject>` (tier-2) | **Yes** | `assertTier2` (§4.2) — covered for all goldens |
| Semantic component coloring applied | **Yes** | §4.3 below — role→color baked as inline `fill` |
| Legend, when present, placed outside boundary boxes | **Partially** | geometry assertion below (legend bbox vs. cluster bbox) — only when the fixture includes a legend |
| No overlapping component boxes | **No (golden-reviewed)** | requires box-bbox intersection over Graphviz layout coords; brittle. Frozen by the committed golden + human review on regen |
| Connection arrows routed behind boxes (z-order) | **Partially** | paint-order: assert edge `<path>`/`<g class="edge">` precede node `<g class="node">` in document order (the §`04 §3.3` z-order pass) |
| Every label contained within its box | **No (golden-reviewed)** | requires text-extent measurement against box geometry; not reliably assertable in v1. Frozen by golden + review |

The architecture fixture (`§7.2`) MUST include at least one `container` (boundary)
and ≥2 distinct `role`s so the assertable properties below have something to bite
on.

```typescript
/**
 * Architecture-specific inspectable properties (REQ-COV-01) that ARE machine-
 * assertable. Geometric "no overlap" / "label contained" are deliberately NOT
 * asserted here — they are frozen by the committed golden and human review on
 * regeneration (see 08 §4.3 table).
 */
import { describe, it, expect } from "vitest";

import { render } from "./render.js";
import { architectureFixture } from "./fixtures.js";

describe("architecture inspectable properties (REQ-COV-01)", () => {
  it("bakes semantic role colors as inline fills (not a shared CSS class)", async () => {
    const { svg } = await render(architectureFixture.spec, { theme: "light" });
    // 04 §3.2 bakes color inline; the colored roles in the fixture must appear as fills.
    expect(svg).toMatch(/<(rect|polygon|ellipse|path)\b[^>]*\bfill="#[0-9a-fA-F]{6}"/);
  });

  it("routes edges behind nodes (edge groups precede node groups in document order)", async () => {
    const { svg } = await render(architectureFixture.spec, { theme: "light" });
    const firstEdge = svg.search(/class="edge"/);
    const firstNode = svg.search(/class="node"/);
    expect(firstEdge).toBeGreaterThanOrEqual(0);
    expect(firstNode).toBeGreaterThanOrEqual(0);
    expect(firstEdge).toBeLessThan(firstNode); // painted first → behind (04 §3.3)
  });
});
```

> If a fixture carries a legend, the legend-outside check compares the legend
> group's bounding box against every `cluster_*` bbox and asserts no containment.
> This is included only when the architecture fixture sets a legend; otherwise it
> is skipped (`it.skip`) with a note, because legend geometry is otherwise frozen by
> the golden.

### 4.4 Theme + accent coverage (REQ-THEME-01)

Because §3 and §4.2 already iterate over `{light, dark}` for every type, light and
dark variants are exercised by construction. The accent override is proven by one
fixture (`architectureFixture.accent = "#2563eb"`) flowing through `render` and the
accent color appearing in its golden; `theme.test.ts` (`04`) owns the unit-level
`resolveTheme` accent assertions.

## 5. Determinism — byte-identical SVG (REQ-REPRO-01)

`determinism.test.ts` (`01 §1`) proves the byte-stability that makes goldens
diff-clean: the same `DiagramSpec` rendered twice **in-process** yields byte-
identical SVG, **after** the `04 §3.7` canonicalization pass (which fixes element/
attribute ordering, coordinate precision via `SVG_COORD_PRECISION`, and
deterministic IDs to neutralize Graphviz-WASM's non-stable raw output — see
`03 §3.4`, `04 §3.7`, tech-spec OTQ-6).

```typescript
/**
 * Determinism (REQ-REPRO-01, proves PRD §8 "regenerating an unchanged spec is
 * diff-clean"). Two in-process `render` calls on the same spec MUST be byte-equal
 * AFTER the 04 §3.7 canonicalization pass. Without canonicalization the graph
 * path's raw Graphviz-WASM SVG is not byte-stable (03 §3.4) — this test guards
 * that the canonicalization pass is present and effective.
 */
import { describe, it, expect } from "vitest";

import { render } from "./render.js";
import { FIXTURES } from "./fixtures.js";

describe("render determinism (REQ-REPRO-01)", () => {
  for (const fixture of FIXTURES) {
    it(`${fixture.spec.diagramType}: two renders are byte-identical`, async () => {
      const a = await render(fixture.spec, { theme: "light", accent: fixture.accent });
      const b = await render(fixture.spec, { theme: "light", accent: fixture.accent });
      expect(a.svg).toBe(b.svg);
      expect(a.width).toBe(b.width);
      expect(a.height).toBe(b.height);
    });
  }
});
```

Covering all six types — including a graph type (whose raw output is the non-stable
one) and the sequence type (direct-SVG, stable by construction) — proves the
canonicalization pass handles the hard case.

## 6. PNG smoke test (REQ-OUT-03, OTQ-5)

PNG is a **smoke test, not a byte comparison**: resvg output varies by
version/platform, so PNG bytes are intentionally not committed as goldens (tech-spec
§8; `04 §4.3`). `@resvg/resvg-wasm` is pinned to an exact version (`@2.6.2`,
`04 §4.1`) to bound drift. The test asserts the PNG is a valid, non-empty PNG of the
expected dimensions within the **±2px** per-axis tolerance set in `04 §4.3`.

```typescript
/**
 * PNG smoke test (REQ-OUT-03, OTQ-5). NOT a byte comparison — resvg output varies
 * by platform; @resvg/resvg-wasm is pinned (04 §4.1) to bound that. Asserts: bytes
 * are non-empty, begin with the PNG magic signature, and decode to intrinsic
 * dimensions × DEFAULT_PNG_SCALE within ±2px per axis (04 §4.3).
 */
import { describe, it, expect } from "vitest";

import { render } from "./render.js";
import { renderPng } from "./png.js";
import { architectureFixture } from "./fixtures.js";

/** PNG magic number: 89 50 4E 47 0D 0A 1A 0A. */
const PNG_MAGIC = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
/** Default raster scale baked into png.ts (04 §4.2: DEFAULT_PNG_SCALE = 2). */
const DEFAULT_PNG_SCALE = 2;
/** Per-axis dimension tolerance (04 §4.3). */
const PNG_TOLERANCE_PX = 2;

/** Decode the IHDR width/height from a PNG byte buffer (bytes 16..24, big-endian). */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("PNG rasterization smoke (REQ-OUT-03)", () => {
  it("produces a valid, correctly-sized, non-empty PNG", async () => {
    const result = await render(architectureFixture.spec, { theme: "light" });
    const png = await renderPng(result.svg);

    expect(png.byteLength).toBeGreaterThan(0);
    expect(png.subarray(0, 8)).toEqual(PNG_MAGIC);

    const { width, height } = pngDimensions(png);
    expect(Math.abs(width - result.width * DEFAULT_PNG_SCALE)).toBeLessThanOrEqual(
      PNG_TOLERANCE_PX,
    );
    expect(Math.abs(height - result.height * DEFAULT_PNG_SCALE)).toBeLessThanOrEqual(
      PNG_TOLERANCE_PX,
    );
  });

  it("wraps a bad SVG as DiagramPngError (exit 5), writing no partial bytes", async () => {
    // 04 §4.4: malformed SVG → DiagramPngError. (Imported lazily to keep the import
    // graph in 00 §5 authoritative.)
    const { DiagramPngError } = await import("./errors.js");
    await expect(renderPng("<not-svg")).rejects.toBeInstanceOf(DiagramPngError);
  });
});
```

## 7. CLI contract tests (REQ-INV-02/03/04, REQ-REL-02, REQ-SEC-01)

`cli.test.ts` proves the **four contract dimensions** of `05 §1` — input form,
output paths, invocable types, exit signaling — that `doc-site-plugin` depends on.
The CLI is exercised through its `main(argv)` entry (`05 §3`,
`export async function main(argv: string[]): Promise<number>`), which returns the
exit code rather than calling `process.exit`, so tests assert the return value
directly. Exit-code expectations come from `EXIT_CODES` (`00 §6`), never re-spelled
literals.

```typescript
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { main } from "./cli.js";
import { EXIT_CODES, CONTRACT_VERSION } from "./schema.js";
import { FIXTURES, architectureFixture } from "./fixtures.js";

/** Make a throwaway temp dir; cleaned up in afterEach (REQ-SEC-01 confinement target). */
function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "diagram-cli-"));
}
const created: string[] = [];
afterEach(() => {
  for (const d of created.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
```

### 7.1 Input forms (dimension 1, REQ-INV-03)

```typescript
describe("CLI input forms (REQ-INV-03 dimension 1)", () => {
  it("reads a spec from a file path", async () => {
    const dir = tmpDir(); created.push(dir);
    const input = path.join(dir, "arch.json");
    fs.writeFileSync(input, JSON.stringify(architectureFixture.spec));
    const code = await main([input, "--out-dir", dir]);
    expect(code).toBe(0);
  });

  it("reads a spec from stdin via '-'", async () => {
    // 05 §3.1: '-' reads JSON from process.stdin; the harness pipes a string in.
    // (Stdin injection helper omitted; assert the parse path is exercised and code 0.)
    const dir = tmpDir(); created.push(dir);
    const code = await runWithStdin(JSON.stringify(architectureFixture.spec), [
      "-",
      "--out-dir",
      dir,
    ]);
    expect(code).toBe(0);
  });
});
```

> `runWithStdin` is a small test helper that substitutes a readable stream for
> `process.stdin` for the duration of one `main` call (or, if the harness prefers,
> spawns the committed bundle and writes to its stdin — see `§7.7`).

### 7.2 Shared fixtures — one minimal valid `DiagramSpec` per type

`fixtures.ts` is the single source of valid inputs for `§3`–`§7`. Each fixture is a
**minimal but representative** `DiagramSpec` that parses against `00 §2` and passes
the `02 §2` cross-field rules (e.g. the `sequence` fixture uses
`participants`/`messages` and empty `nodes`; the graph fixtures use
`nodes`/`edges`). The architecture fixture additionally carries ≥1 container and ≥2
roles (and an accent) for `§4.3`/`§4.4`.

```typescript
/**
 * Shared diagram test fixtures (08 §7.2): one minimal valid DiagramSpec per type,
 * conforming to the 00 §2 schema and the 02 §2 cross-field invariants. Reused by
 * the golden, property, determinism, PNG, and CLI suites so all tests agree on
 * the inputs.
 */
import type { DiagramSpec } from "./schema.js";

/** A fixture pairs a spec with an optional accent for theme-override coverage. */
export interface DiagramFixture {
  readonly spec: DiagramSpec;
  readonly accent?: string;
}

/** Architecture: containers + multiple roles + accent (drives REQ-COV-01 §4.3). */
export const architectureFixture: DiagramFixture = {
  accent: "#2563eb",
  spec: {
    diagramType: "architecture",
    title: "Web Service",
    description: "A frontend talking to a backend and a database.",
    theme: "light",
    nodes: [
      { id: "web", label: "Web", role: "frontend" },
      { id: "api", label: "API", role: "backend" },
      { id: "db", label: "DB", role: "database", shape: "cylinder" },
    ],
    edges: [
      { from: "web", to: "api", label: "HTTP" },
      { from: "api", to: "db", label: "SQL" },
    ],
    containers: [{ id: "svc", label: "Service", children: ["api", "db"] }],
    participants: [],
    messages: [],
  },
};

/** Sequence fixture: participants + messages, empty graph fields (02 §2.5). */
export const sequenceFixture: DiagramFixture = {
  spec: {
    diagramType: "sequence",
    title: "Login",
    description: "A user authenticates against the API.",
    theme: "light",
    nodes: [],
    edges: [],
    containers: [],
    participants: [
      { id: "user", label: "User", role: "external" },
      { id: "api", label: "API", role: "backend" },
    ],
    messages: [
      { from: "user", to: "api", label: "POST /login", kind: "sync", activate: true },
      { from: "api", to: "user", label: "200 OK", kind: "reply" },
    ],
  },
};

// flowchartFixture, erFixture, stateFixture, dataflowFixture follow the same
// graph shape as architectureFixture (nodes/edges, empty sequence fields), each
// minimal for its type. Omitted here for brevity; all six are exported in FIXTURES.

/** Every fixture, in stable order (drives the table-driven golden/property loops). */
export const FIXTURES: readonly DiagramFixture[] = [
  architectureFixture,
  flowchartFixture,
  sequenceFixture,
  erFixture,
  stateFixture,
  dataflowFixture,
];
```

### 7.3 Output paths & precedence (dimension 2, REQ-INV-03, tech v2 V-007)

Each precedence branch of `05 §2.3`
(`--out-file > (--out-dir + --out-name) > (--out-dir + slug) > stdout`) gets a case:

```typescript
describe("CLI output paths & precedence (REQ-INV-03 dimension 2)", () => {
  it("--out-file writes the exact caller path", async () => {
    const dir = tmpDir(); created.push(dir);
    const out = path.join(dir, "diagram.svg");
    const code = await main([await specFile(dir), "--out-file", out]);
    expect(code).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
  });

  it("--out-dir + --out-name writes <name>.<ext> (overrides slug)", async () => {
    const dir = tmpDir(); created.push(dir);
    const code = await main([await specFile(dir), "--out-dir", dir, "--out-name", "custom"]);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(dir, "custom.svg"))).toBe(true);
  });

  it("--out-dir alone derives <slug>.<theme>.<ext>", async () => {
    const dir = tmpDir(); created.push(dir);
    const code = await main([await specFile(dir), "--out-dir", dir, "--theme", "dark"]);
    expect(code).toBe(0);
    // slug from title "Web Service" → "web-service" (00 §3.2 / 05 §2.3).
    expect(fs.existsSync(path.join(dir, "web-service.dark.svg"))).toBe(true);
  });

  it("--format both swaps the extension per artifact (.svg + .png)", async () => {
    const dir = tmpDir(); created.push(dir);
    const out = path.join(dir, "arch.svg");
    const code = await main([await specFile(dir), "--out-file", out, "--format", "both"]);
    expect(code).toBe(0);
    expect(fs.existsSync(path.join(dir, "arch.svg"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "arch.png"))).toBe(true);
  });

  it("no output target with a single artifact streams SVG to stdout", async () => {
    const { code, stdout } = await captureStdout([await specFile(tmpDirTracked())]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^<\?xml|^<svg/);
  });

  it("refuses PNG-to-stdout (binary on a text stream) with USAGE_ERROR", async () => {
    const code = await main([await specFile(tmpDirTracked()), "--format", "png"]);
    expect(code).toBe(EXIT_CODES.USAGE_ERROR);
  });
});
```

### 7.4 Invocable types & exit codes (dimensions 3 + 4, REQ-INV-03, REQ-REL-02)

```typescript
describe("CLI invocable types (REQ-INV-03 dimension 3)", () => {
  for (const fixture of FIXTURES) {
    it(`--type ${fixture.spec.diagramType} renders to exit 0`, async () => {
      const dir = tmpDir(); created.push(dir);
      const input = path.join(dir, "spec.json");
      fs.writeFileSync(input, JSON.stringify(fixture.spec));
      const code = await main([input, "--type", fixture.spec.diagramType, "--out-dir", dir]);
      expect(code).toBe(0);
    });
  }
});

describe("CLI exit signaling (REQ-INV-03 dimension 4, REQ-REL-02)", () => {
  it("bad spec → INPUT_INVALID, no file written", async () => {
    const dir = tmpDir(); created.push(dir);
    const input = path.join(dir, "bad.json");
    fs.writeFileSync(input, JSON.stringify({ diagramType: "architecture" })); // missing title/desc
    const code = await main([input, "--out-dir", dir]);
    expect(code).toBe(EXIT_CODES.INPUT_INVALID); // 2
    expect(fs.readdirSync(dir)).toEqual(["bad.json"]); // nothing emitted
  });

  it("forced <foreignObject> leak → OUTPUT_INVALID", async () => {
    // 02 §3.3 / 04 §3: inject a foreignObject into the render path so the output
    // assertion fires. The harness uses a fault-injecting spec/env hook (see note);
    // the assertion under test is `render`'s assertOutputValid gate (03 §5).
    await expect(renderWithForcedForeignObject()).rejects.toMatchObject({
      code: "OUTPUT_INVALID",
      exitCode: EXIT_CODES.OUTPUT_INVALID, // 4
    });
  });

  it("bad usage (unknown flag) → USAGE_ERROR (64)", async () => {
    const code = await main([await specFile(tmpDirTracked()), "--bogus"]);
    expect(code).toBe(EXIT_CODES.USAGE_ERROR);
  });

  it("missing input → USAGE_ERROR (64)", async () => {
    const code = await main([]);
    expect(code).toBe(EXIT_CODES.USAGE_ERROR);
  });
});
```

> **`<foreignObject>` fault injection.** `render` never emits a `<foreignObject>` on
> any real path (`03 §2.1` forbids it in DOT), so the OUTPUT_INVALID case is proven
> at the validator boundary: feed a synthetic SVG carrying `<foreignObject>` directly
> to `assertOutputValid` and assert it throws `DiagramOutputError` (code
> `OUTPUT_INVALID`, exit 4). This is the same gate `render.ts` calls (`03 §5`), so it
> proves the CLI would exit 4 on a leak without needing to corrupt the engine. Owned
> jointly with `02`'s `validate.test.ts`; `08` asserts the **exit-code mapping**.

### 7.5 `--version` (REQ-INV-04)

```typescript
describe("CLI --version (REQ-INV-04)", () => {
  it("prints CONTRACT_VERSION and exits 0", async () => {
    const { code, stdout } = await captureStdout(["--version"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(CONTRACT_VERSION); // "1.0.0" (00 §6)
  });
});
```

### 7.6 Path confinement (REQ-SEC-01)

```typescript
describe("CLI path confinement (REQ-SEC-01)", () => {
  it("an --out-dir + name that escapes the dir is rejected with IO_ERROR", async () => {
    const dir = tmpDir(); created.push(dir);
    // 05 §3.3 confines writes to the caller's dir; a traversal name must be refused.
    const code = await main([await specFile(dir), "--out-dir", dir, "--out-name", "../escape"]);
    expect(code).toBe(EXIT_CODES.IO_ERROR); // 6
    expect(fs.existsSync(path.resolve(dir, "../escape.svg"))).toBe(false);
  });
});
```

### 7.7 In-process vs. bundle execution

The default suite calls `main(argv)` **in-process** (fast, gives direct exit codes
and lets us inject stdin/stdout). One additional smoke case executes the **committed
bundle** end-to-end to prove the zero-install path (`01 §2.2`,
`01` Verification): spawn
`bun skills/diagram-generator/scripts/diagram-render.mjs <spec> --out-dir <tmp>`
with `execFileSync` (the pattern `src/schema-gen.test.ts:15-22` uses) and assert
exit 0 and the artifact exists. This guards that the bundle actually runs, not just
the source.

## 8. Emission / gate guard (REQ-PORT-02)

Adding the skill must keep `bun run gate` green. This reuses the existing emitter
golden machinery rather than adding diagram-local tests, per
`06-integration-and-packaging.md` §3:

1. **Emitted-tree goldens + `SAMPLE_RELPATHS`.** The new skill's per-target emitted
   relpaths are registered in `SAMPLE_RELPATHS` (`src/test/golden.shared.ts`) and
   committed under `src/test/__golden__/<target>/…`. `src/test/golden.test.ts`'s
   three-way set equality (verified at `golden.test.ts:76-78`) then fails if a
   target's emission drifts from the registered relpaths — proving REQ-PORT-02
   (same skill, all five targets). The exact per-target relpath set (claude/codex
   `skills/diagram-generator/SKILL.md`, gemini
   `skills/diagram-generator/diagram-generator.md`, copilot
   `instructions/diagram-generator.instructions.md`, cursor
   `rules/diagram-generator.mdc`, plus relocated `references/`+`scripts/`) is
   enumerated in `06-integration-and-packaging.md` §3 and must be mirrored here when
   registered.
2. **Diagram schema drift.** `schema:check:diagram` (`01 §5`) fails if the committed
   `schemas/diagram-input.schema.json` differs from a fresh generation — the same
   discipline `src/schema-gen.test.ts` applies to the manifest schema. Owned by
   `02-schema-and-validation.md` §4 / `06-integration-and-packaging.md`.
3. **Bundle drift.** `build:diagram:check` (`01 §5`,
   `06-integration-and-packaging.md` §4) re-bundles `src/diagram/cli.ts` in memory
   and fails on any difference from the committed
   `skills/diagram-generator/scripts/diagram-render.mjs`. This owns bundle bytes
   (tech-spec OTQ-1); goldens do not byte-compare the bundle.

All three are wired into the extended `gate` script (`01 §5`):
`… && schema:check:diagram && … && test && build:check && build:diagram:check`. A
green `gate` after adding the skill is the proof of PRD §8's "authored once, emits to
all five targets, behaves equivalently."

## 9. Coverage targets

The suite layers cheap exhaustive unit tests under a smaller set of integration
tests:

| Area | Strategy | Target |
| --- | --- | --- |
| `schema.ts`, `validate.ts` (parse + cross-field + output asserts) | exhaustive unit (owned by `00`/`02`) | high line+branch (≈100% — pure logic) |
| `dot-emit.ts`, `theme.ts`, `svg-postprocess.ts` (pure transforms) | unit (owned by `03`/`04`) + golden coverage | high line+branch |
| `graph-render.ts`, `sequence-svg.ts`, `render.ts` | golden + property + determinism (§3–§5) | every type × theme exercised |
| `png.ts` | smoke only (§6) — not byte-compared | one valid + one error path |
| `cli.ts` | contract tests (§7) — every dimension, every exit code | every precedence branch + every `EXIT_CODES` entry |
| emitter integration | existing `golden.test.ts` + drift checks (§8) | gate-green |

No formal global coverage-percentage gate is added beyond what the repo already
enforces; the bar is **behavioral**: every PRD §8 criterion has a named test
(`Requirement Coverage` table), every `EXIT_CODES` entry is asserted at least once
(§7.4–§7.6), and every diagram type has a golden + property + determinism case.

## Dependencies

This is the always-last document; it depends on **all** prior spec docs:

- `00-core-definitions.md` — `DiagramSpec`, `RenderResult`, the error classes,
  `EXIT_CODES`, `CONTRACT_VERSION`, `SVG_COORD_PRECISION` (all referenced by the
  tests).
- `01-architecture-layout.md` — test file placement (`src/diagram/*.test.ts`),
  `__golden__/` location, the extended `gate` script (§8).
- `02-schema-and-validation.md` — `parseSpec` and the output validators
  (`assertOutputValid`/`assertTier2`/`assertStructural`/`assertFontPortable`/
  `assertA11y`) reused by §4; the diagram schema-gen drift check (§8).
- `03-rendering-engine.md` — `render(spec, opts)` (the entry the golden,
  determinism, PNG, and architecture-property tests drive); the no-`<foreignObject>`
  guarantee (§4.3, §7.4).
- `04-theme-postprocess-png.md` — `renderPng(svg, opts)`, `DEFAULT_PNG_SCALE`, the
  ±2px tolerance, the pinned `@resvg/resvg-wasm@2.6.2`, and the canonicalization pass
  that makes §5 byte-stable.
- `05-cli-and-invocation.md` — `main(argv)`, the output-path precedence, `--version`,
  and the exit-code mapping the §7 contract tests assert.
- `06-integration-and-packaging.md` — `SAMPLE_RELPATHS` registration, the
  `build:diagram:check` bundle drift guard, and the per-target emitted relpaths the
  §8 gate guard depends on.

## Verification

- [ ] `vitest run` (the `package.json` `test` script) executes the diagram suite
      with no new framework.
- [ ] `src/diagram/__golden__/` contains exactly 12 committed SVGs (`<type>.<theme>.svg`
      for all six types × `{light,dark}`).
- [ ] `bun run src/diagram/regenerate-goldens.ts` rewrites those 12 files and they are
      NOT auto-overwritten by a plain `vitest run`.
- [ ] `golden.test.ts` renders each fixture × theme and asserts byte-equality (§3).
- [ ] `property.test.ts` runs `assertOutputValid` + each individual `02 §3` assertion
      over every golden, plus literal-markup checks (REQ-OUT-01/02/04, REQ-A11Y-01).
- [ ] `determinism.test.ts` asserts two `render` calls are byte-identical for all six
      types (REQ-REPRO-01).
- [ ] `png.test.ts` asserts a valid PNG with the magic signature and dimensions
      within ±2px (REQ-OUT-03), and a bad SVG → `DiagramPngError`.
- [ ] `cli.test.ts` covers: file + stdin input; every output-path precedence branch;
      every `--type`; `--version` = `CONTRACT_VERSION`; and every `EXIT_CODES` entry
      (INPUT_INVALID, OUTPUT_INVALID, USAGE_ERROR, IO_ERROR) is asserted.
- [ ] One bundle-execution smoke case runs
      `skills/diagram-generator/scripts/diagram-render.mjs` and exits 0 (§7.7).
- [ ] `fixtures.ts` exports one minimal valid `DiagramSpec` per type and all six are
      in `FIXTURES`.
- [ ] After registering `SAMPLE_RELPATHS` + emitted goldens, `bun run gate` (with
      `schema:check:diagram` and `build:diagram:check`) stays green (REQ-PORT-02).
- [ ] No PNG bytes are committed as goldens (resvg variance; §6).
