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

import { FIXTURES } from "./fixtures.js";
import { GOLDEN_DIR, GOLDEN_THEMES, goldenFileName } from "./golden.shared.js";
import { render } from "./render.js";

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
