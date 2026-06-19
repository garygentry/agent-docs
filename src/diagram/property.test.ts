/**
 * Output-property assertions over every committed golden SVG (08 §4). Reuses the
 * 02 §3 validators so the test enforces the SAME tier-2/structural/font/a11y
 * contract that `render.ts` gates on at emit time (do NOT re-implement the checks,
 * 08 §4.1).
 *
 * Proves PRD §8: tier-2 portability (REQ-OUT-01), explicit viewBox+w/h
 * (REQ-OUT-02), no network / embedded font (REQ-OUT-04/REQ-SEC-02), and
 * <title>/<desc>/role="img" (REQ-A11Y-01). §4.3 adds architecture-specific
 * machine-assertable properties; §4.4 exercises theme + accent coverage.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, it, expect } from "vitest";

import { render } from "./render.js";
import { FIXTURES, architectureFixture } from "./fixtures.js";
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

      it('carries <title>, <desc>, and role="img" (REQ-A11Y-01)', () => {
        const doc = assertWellFormed(svg);
        expect(() => assertA11y(doc)).not.toThrow();
        expect(svg).toContain("<title");
        expect(svg).toContain("<desc");
        expect(svg).toMatch(/<svg\b[^>]*\brole="img"/);
      });
    });
  }
});

/**
 * Architecture-specific inspectable properties (REQ-COV-01) that ARE machine-
 * assertable (08 §4.3 table). Geometric "no overlap" / "label contained" are
 * deliberately NOT asserted — they are frozen by the committed golden and human
 * review on regeneration.
 */
describe("architecture inspectable properties (REQ-COV-01)", () => {
  it("bakes semantic role colors as inline fills (not a shared CSS class)", async () => {
    const { svg } = await render(architectureFixture.spec, { theme: "light" });
    // 04 §3.2 bakes color inline; the colored roles in the fixture must appear as fills.
    expect(svg).toMatch(/<(rect|polygon|ellipse|path)\b[^>]*\bfill="#[0-9a-fA-F]{6}"/);
  });

  it("routes edges behind nodes (edge groups precede node groups in document order)", async () => {
    const { svg } = await render(architectureFixture.spec, { theme: "light" });
    const firstEdge = svg.search(/class="edge[\s"]/);
    const firstNode = svg.search(/class="node[\s"]/);
    expect(firstEdge).toBeGreaterThanOrEqual(0);
    expect(firstNode).toBeGreaterThanOrEqual(0);
    expect(firstEdge).toBeLessThan(firstNode); // painted first → behind (04 §3.3)
  });
});

/**
 * Theme + accent coverage (REQ-THEME-01, 08 §4.4). Light/dark are exercised by
 * construction above (every type × {light,dark}); this proves the accent override
 * flows through `render` and the accent color appears in the output, and that
 * light vs dark produce distinct artifacts.
 */
describe("theme + accent coverage (REQ-THEME-01)", () => {
  it("the architecture accent (#2563eb) flows through render into the SVG", async () => {
    expect(architectureFixture.accent).toBe("#2563eb");
    const { svg } = await render(architectureFixture.spec, {
      theme: "light",
      accent: architectureFixture.accent,
    });
    expect(svg.toLowerCase()).toContain("#2563eb");
  });

  it("light and dark variants of the same spec are distinct", async () => {
    const light = await render(architectureFixture.spec, { theme: "light" });
    const dark = await render(architectureFixture.spec, { theme: "dark" });
    expect(light.svg).not.toBe(dark.svg);
  });
});
