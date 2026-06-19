/**
 * Shared constants for the golden snapshot suite (08 §6) and its regeneration
 * script (08 §6.3). Kept in one place so the test asserting byte-equality and the
 * `regenerate-goldens.ts` writer agree on scope, paths, and identity.
 */
import * as path from "node:path";

import { assemblePluginMeta } from "../cli.js";
import type { EmitIdentity } from "../emit.js";
import type { Target } from "../model.js";

/** Repo root: src/test → repo root (two levels up). */
export const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

/** Checked-in golden tree: `src/test/__golden__`. */
export const GOLDEN_ROOT = path.resolve(import.meta.dirname, "__golden__");

/**
 * Aggregate-manifest identity used when emitting the sample (07 §3.2). Derived from
 * `package.json` via the SAME `assemblePluginMeta` the CLI uses on a real build, so
 * the gemini `gemini-extension.json` golden matches the committed adapter exactly
 * (single identity source of truth, 07 §3.2).
 */
const meta = assemblePluginMeta(REPO_ROOT);
export const GOLDEN_IDENTITY: EmitIdentity = { name: meta.name, version: meta.version };

/**
 * Exact bundle-relative (`<target>/`-stripped) relpaths the docs-helper sample
 * SKILL emits per target, pinned from the per-target rules tables in 04 §6–§10 —
 * NOT inferred from extension / `.includes()` heuristics (which silently admit
 * unrelated files). The sample is skill-only, so codex emits no `agents/openai.yaml`
 * aggregate; only gemini contributes an aggregate manifest.
 *
 * Scope note (06 §5.4): the golden suite asserts `emit().files`, which holds the
 * TRANSFORMED outputs only (SKILL files + gemini aggregate). A skill's verbatim
 * owned subtree (`references/*`, `scripts/diagram-render.mjs`) is carried in
 * `emit().verbatim`, not `files`, so it is NOT registered here — its bytes (and the
 * executable-mode-preserving copy) are pinned instead by the whole-tree
 * `build:check` against the committed `adapters/<target>/` tree. Per §5.4 the actual
 * emitter output is the source of truth for this set.
 */
export const SAMPLE_RELPATHS: Record<Target, string[]> = {
  claude: [
    "skills/docs-helper/SKILL.md", // 04 §6.1
    "skills/diagram-generator/SKILL.md", // 06 §5.2 (SKILL transform; refs/scripts are verbatim — see note)
  ],
  codex: [
    "skills/docs-helper/SKILL.md", // 04 §7.1 (skill only — no agents → no openai.yaml)
    "skills/diagram-generator/SKILL.md", // 06 §5.2
  ],
  copilot: [
    "instructions/docs-helper.instructions.md", // 04 §10.1
    "instructions/diagram-generator.instructions.md", // 06 §5.2
  ],
  cursor: [
    "rules/docs-helper.mdc", // 04 §8.1
    "rules/diagram-generator.mdc", // 06 §5.2
  ],
  gemini: [
    "skills/docs-helper/docs-helper.md", // 04 §9.1 (skill + aggregate)
    "gemini-extension.json",
    "skills/diagram-generator/diagram-generator.md", // 06 §5.2
  ],
};
