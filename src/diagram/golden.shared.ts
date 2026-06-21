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
