/**
 * Determinism (REQ-REPRO-01, proves PRD §8 "regenerating an unchanged spec is
 * diff-clean"). Two in-process `render` calls on the same spec MUST be byte-equal
 * AFTER the 04 §3.7 canonicalization pass. Without canonicalization the graph
 * path's raw Graphviz-WASM SVG is not byte-stable (03 §3.4) — this test guards
 * that the canonicalization pass is present and effective. It also asserts each
 * render matches its committed golden (08 §5).
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, it, expect } from "vitest";

import { render } from "./render.js";
import { FIXTURES } from "./fixtures.js";
import { GOLDEN_DIR, GOLDEN_THEMES, goldenFileName } from "./golden.shared.js";

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

  for (const fixture of FIXTURES) {
    for (const theme of GOLDEN_THEMES) {
      it(`${fixture.spec.diagramType}.${theme}: render matches the committed golden`, async () => {
        const { svg } = await render(fixture.spec, { theme, accent: fixture.accent });
        const abs = path.join(GOLDEN_DIR, goldenFileName(fixture.spec.diagramType, theme));
        const golden = fs.readFileSync(abs, "utf8");
        expect(svg).toBe(golden);
      });
    }
  }
});
