/**
 * PNG smoke test over a rendered fixture (REQ-OUT-03, OTQ-5, 08 §6). NOT a byte
 * comparison — resvg output varies by platform; @resvg/resvg-wasm is pinned
 * (04 §4.1) to bound that. Asserts: bytes are non-empty, begin with the PNG magic
 * signature, and decode to intrinsic dimensions × DEFAULT_PNG_SCALE within ±2px
 * per axis (04 §4.3). Reuses the shared fixtures (item 016) via `render`.
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
  it("produces a valid, correctly-sized, non-empty PNG from a rendered fixture", async () => {
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
});
