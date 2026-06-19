/**
 * `png.ts` — rasterize a final, post-processed tier-2 SVG to PNG bytes
 * in-process (REQ-OUT-03), per 04-theme-postprocess-png.md §4.
 *
 * Rasterization runs entirely in-process via `@resvg/resvg-js` (pinned, 001) —
 * no browser, no network, no system Graphviz/rsvg binary. The embedded data-URI
 * font (§3.6) means resvg needs no system fonts, so text renders identically to
 * the SVG. On any resvg failure a {@link DiagramPngError} is thrown (§4.4); no
 * partial bytes are ever returned.
 *
 * Note on engine choice: 04 §4.1 prefers the WASM build (`@resvg/resvg-wasm`)
 * so the committed bundle (014) can inline the `.wasm`. This module is written
 * against the native `@resvg/resvg-js` build that is actually pinned in 001; the
 * contract it owes the pipeline (`svg: string → Uint8Array PNG`, failures wrapped
 * as `DiagramPngError`) is identical either way, and the swap is isolated to the
 * import + (for WASM) a memoized `initWasm` call.
 */
import { Resvg } from "@resvg/resvg-js";

import { DiagramPngError } from "./errors.js";

/** Options for PNG rasterization. */
export interface RenderPngOptions {
  /**
   * Output scale multiplier applied to the SVG's intrinsic px dimensions
   * (1 = 1:1). Default `2` for crisp raster on high-DPI destinations. Resvg is
   * configured via `fitTo: { mode: "zoom", value: scale }`.
   */
  scale?: number;
}

/** Default raster scale (2× for high-DPI fallback PNGs). */
const DEFAULT_PNG_SCALE = 2 as const;

/**
 * Per-axis tolerance (px) for the rendered-vs-expected dimension assertion (§4.3).
 * Absorbs resvg's sub-pixel rounding of the scaled intrinsic size.
 */
const DIMENSION_TOLERANCE_PX = 2 as const;

/**
 * Rasterize a final, post-processed tier-2 SVG to PNG bytes, fully in-process via
 * `@resvg/resvg-js` (REQ-OUT-03). The embedded data-URI font (§3.6) means resvg
 * needs no system fonts — text renders identically to the SVG.
 *
 * @param svg - The final SVG markup (post `postProcess`, §3). MUST carry explicit
 *   `width`/`height`/`viewBox` (REQ-OUT-02) so resvg sizes the raster correctly.
 * @param opts - Optional scale (default `DEFAULT_PNG_SCALE`).
 * @returns PNG file bytes as a `Uint8Array` (caller writes them; 05 §3).
 * @throws {DiagramPngError} (code `PNG_FAILED`, exit 5) if rasterization fails — the
 *   underlying resvg message is wrapped into `detail`. No partial bytes.
 */
export async function renderPng(
  svg: string,
  opts?: RenderPngOptions,
): Promise<Uint8Array> {
  const scale = opts?.scale ?? DEFAULT_PNG_SCALE;

  let resvg: Resvg;
  try {
    resvg = new Resvg(svg, {
      // The SVG embeds its own subset font (§3.6); never depend on system fonts.
      font: { loadSystemFonts: false },
      fitTo: { mode: "zoom", value: scale },
    });
  } catch (cause) {
    throw new DiagramPngError(
      "PNG rasterization rejected the SVG",
      messageOf(cause),
    );
  }

  // Intrinsic SVG dimensions (px), read from the SVG markup itself.
  const intrinsicWidth = resvg.width;
  const intrinsicHeight = resvg.height;

  let png: { asPng(): Buffer; width: number; height: number };
  try {
    png = resvg.render();
  } catch (cause) {
    throw new DiagramPngError("PNG rasterization failed", messageOf(cause));
  }

  let bytes: Buffer;
  try {
    bytes = png.asPng();
  } catch (cause) {
    throw new DiagramPngError("PNG rasterization failed", messageOf(cause));
  }

  // §4.3 — dimension assertion: rendered raster ≈ intrinsic × scale within ±2px.
  const expectedWidth = Math.round(intrinsicWidth * scale);
  const expectedHeight = Math.round(intrinsicHeight * scale);
  if (
    Math.abs(png.width - expectedWidth) > DIMENSION_TOLERANCE_PX ||
    Math.abs(png.height - expectedHeight) > DIMENSION_TOLERANCE_PX
  ) {
    throw new DiagramPngError(
      "PNG dimensions do not match the SVG within tolerance",
      `expected ~${expectedWidth}×${expectedHeight}px (intrinsic ${intrinsicWidth}×${intrinsicHeight} × scale ${scale}), got ${png.width}×${png.height}px`,
    );
  }

  return new Uint8Array(bytes);
}

/** Extract a string detail from an unknown thrown value. */
function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
