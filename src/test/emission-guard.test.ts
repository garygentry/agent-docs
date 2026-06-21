/**
 * Emission / gate guard (08 §8, item 018) — asserts the diagram-generator skill
 * emits to ALL FIVE targets (REQ-PORT-02, CON-01), aligned with the per-target
 * relpaths registered in `SAMPLE_RELPATHS` (item 015, 06 §5.2).
 *
 * Complements `golden.test.ts` (which proves byte-equality of the transformed
 * SKILL files): this guard proves COVERAGE — every target receives both the
 * transformed SKILL file (in `result.files`) and the verbatim self-contained
 * bundle `scripts/diagram-render.mjs` (in `result.verbatim`), so the skill is
 * "authored once, emits to all five targets" (PRD §8 / REQ-PORT-02).
 */
import * as path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { resolveConfig } from "../config.js";
import { emit } from "../emit.js";
import { loadManifest } from "../manifest.js";
import { TARGET_ORDER, type EmitResult } from "../model.js";
import { GOLDEN_IDENTITY, REPO_ROOT, SAMPLE_RELPATHS } from "./golden.shared.js";

/** The bundle's leaf path; the per-target prefix is relocated (claude/codex/gemini
 *  under `skills/`, copilot under `instructions/`, cursor under `rules/`). */
const BUNDLE_LEAF = "diagram-generator/scripts/diagram-render.mjs";

describe("diagram-generator emission guard (08 §8, REQ-PORT-02)", () => {
  let result: EmitResult;

  beforeAll(() => {
    const manifest = loadManifest(path.join(REPO_ROOT, "tools.manifest.json"), REPO_ROOT);
    const roots = resolveConfig(manifest.config, REPO_ROOT);
    result = emit(manifest, roots, GOLDEN_IDENTITY);
  });

  for (const target of TARGET_ORDER) {
    it(`emits the diagram-generator SKILL to ${target}`, () => {
      // The skill's transformed SKILL relpath registered for this target (06 §5.2).
      const skillRel = SAMPLE_RELPATHS[target].find((r) => r.includes("diagram-generator"));
      expect(skillRel, `no diagram-generator relpath registered for ${target}`).toBeTruthy();
      const emitted = result.files.map((f) => f.relpath);
      expect(emitted).toContain(`${target}/${skillRel}`);
    });

    it(`copies the verbatim diagram bundle .mjs to ${target}`, () => {
      const verbatim = result.verbatim
        .map((v) => v.relpath)
        .filter((r) => r.startsWith(`${target}/`));
      expect(
        verbatim.some((r) => r.endsWith(BUNDLE_LEAF)),
        `${target} is missing the verbatim ${BUNDLE_LEAF}`,
      ).toBe(true);
    });
  }

  it("covers exactly the five known targets (no target silently dropped)", () => {
    expect(TARGET_ORDER).toHaveLength(5);
  });
});
