/**
 * build-check.test.ts — bundle byte-golden test (06 §4.3; REQ-OUT-04/REQ-REPRO-01).
 *
 * Pins the committed CLI bundle bytes in two places that move together:
 *  1. THIS byte golden under `__bundle_golden__/diagram-render.mjs` (06 §4.3, OTQ-1),
 *     byte-compared here against the shipped bundle;
 *  2. a fresh in-memory rebuild performed by `build:diagram:check` (06 §4.2) — that
 *     guard uses `Bun.build`, which is unavailable under the vitest/node runtime, so
 *     it runs as the `bun run build:diagram:check` CLI in `gate`, not in this suite.
 *
 * When the bundle legitimately changes, regenerate BOTH in the same commit:
 *   bun run build:diagram
 *   cp skills/diagram-generator/scripts/diagram-render.mjs \
 *      src/diagram/__bundle_golden__/diagram-render.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { BUNDLE_OUTPUT_PATH } from "./build-check.js";

/** Repo root: src/diagram → repo root (two levels up). */
const REPO_ROOT = resolve(import.meta.dirname, "../..");

/** The committed shipped bundle. */
const COMMITTED_BUNDLE = resolve(REPO_ROOT, BUNDLE_OUTPUT_PATH);

/** The committed byte golden (06 §4.3). */
const BUNDLE_GOLDEN = resolve(REPO_ROOT, "src/diagram/__bundle_golden__/diagram-render.mjs");

describe("CLI bundle integrity (06 §4)", () => {
  it("committed bundle is byte-identical to the byte golden (§4.3)", () => {
    const committed = readFileSync(COMMITTED_BUNDLE);
    const golden = readFileSync(BUNDLE_GOLDEN);
    expect(committed.equals(golden)).toBe(true);
  });
});
