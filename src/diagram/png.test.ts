import { describe, it, expect } from "vitest";

import { DiagramPngError } from "./errors.js";
import { renderPng } from "./png.js";

/** PNG magic signature: 89 50 4E 47 0D 0A 1A 0A. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/**
 * A minimal, well-formed tier-2 SVG with explicit width/height/viewBox — the
 * shape `postProcess` (§3) guarantees. resvg sizes the raster from these.
 */
const VALID_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80" role="img"><title>t</title><desc>d</desc><rect x="10" y="10" width="100" height="60" fill="#2563eb" stroke="#1e3a8a"/></svg>`;

describe("renderPng — SVG → PNG via @resvg/resvg-js (REQ-OUT-03)", () => {
  it("rasterizes a finished SVG to a non-empty PNG beginning with the magic bytes", async () => {
    const png = await renderPng(VALID_SVG);
    expect(png).toBeInstanceOf(Uint8Array);
    expect(png.length).toBeGreaterThan(0);
    expect(Array.from(png.slice(0, 8))).toEqual([...PNG_MAGIC]);
  });

  it("produces PNG dimensions = intrinsic × scale within ±2px tolerance", async () => {
    // Default scale is 2 → expect ~240×160.
    const png2x = await renderPng(VALID_SVG);
    const dims2x = pngDimensions(png2x);
    expect(Math.abs(dims2x.width - 240)).toBeLessThanOrEqual(2);
    expect(Math.abs(dims2x.height - 160)).toBeLessThanOrEqual(2);

    // scale 1 → expect ~120×80.
    const png1x = await renderPng(VALID_SVG, { scale: 1 });
    const dims1x = pngDimensions(png1x);
    expect(Math.abs(dims1x.width - 120)).toBeLessThanOrEqual(2);
    expect(Math.abs(dims1x.height - 80)).toBeLessThanOrEqual(2);
  });

  it("throws DiagramPngError for a malformed SVG", async () => {
    await expect(renderPng("<svg this is not valid")).rejects.toBeInstanceOf(
      DiagramPngError,
    );
  });

  it("wraps the failure into DiagramPngError.detail", async () => {
    let caught: unknown;
    try {
      await renderPng("<not-svg/>");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DiagramPngError);
    expect((caught as DiagramPngError).code).toBe("PNG_FAILED");
    expect((caught as DiagramPngError).exitCode).toBe(5);
  });
});

/** Read pixel width/height from a PNG IHDR chunk (bytes 16–23, big-endian). */
function pngDimensions(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
