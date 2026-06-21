import type { Target } from "../model.js";
import type { TargetTransform } from "./_shared.js";
import { claudeTransform } from "./claude.js";
import { codexTransform } from "./codex.js";
import { copilotTransform } from "./copilot.js";
import { cursorTransform } from "./cursor.js";
import { geminiTransform } from "./gemini.js";

export type { TargetTransform, TransformOutput } from "./_shared.js";

/**
 * The target registry (04 §2). Keys MUST be exactly the five Targets; the engine in
 * `05-overrides-publish-determinism.md` iterates in TARGET_ORDER, not in object
 * insertion order, so iteration is deterministic regardless of key order
 * (REQ-EMIT-06).
 */
export const TRANSFORMS: Record<Target, TargetTransform> = {
  claude: claudeTransform,
  codex: codexTransform,
  copilot: copilotTransform,
  cursor: cursorTransform,
  gemini: geminiTransform,
};
