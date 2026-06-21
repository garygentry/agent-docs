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

import { describe, expect, it } from "vitest";

import { FIXTURES } from "./fixtures.js";
import { GOLDEN_DIR, GOLDEN_THEMES, goldenFileName } from "./golden.shared.js";
import { render } from "./render.js";

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
