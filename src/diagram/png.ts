/**
 * `png.ts` — rasterize a final, post-processed tier-2 SVG to PNG bytes
 * in-process (REQ-OUT-03), per 04-theme-postprocess-png.md §4.
 *
 * Rasterization runs entirely in-process via `@resvg/resvg-wasm` (pinned) —
 * no browser, no network, no system Graphviz/rsvg binary. The embedded data-URI
 * font (§3.6) means resvg needs no system fonts, so text renders identically to
 * the SVG. On any resvg failure a {@link DiagramPngError} is thrown (§4.4); no
 * partial bytes are ever returned.
 *
 * Engine choice: the WASM build (`@resvg/resvg-wasm`, 04 §4.1) so the committed
 * bundle (014) inlines the `.wasm` and stays fully self-contained — no native
 * `.node` addon to resolve at runtime (`01` §5 caveat). The WASM bytes are inlined
 * via `assets/resvg-wasm.ts` (base64) and passed to `initWasm` once per process
 * (memoized, like `getViz` in `03` §3.2). The contract this module owes the pipeline
 * (`svg: string → Uint8Array PNG`, failures wrapped as `DiagramPngError`) is
 * unchanged from the native build.
 */
import { initWasm, Resvg } from "@resvg/resvg-wasm";

import { FONT_BUFFER_BYTES } from "./assets/font.buffer.js";
import { RESVG_WASM_BYTES } from "./assets/resvg-wasm.js";
import { DiagramPngError } from "./errors.js";

/** WASM init is one-shot per process; guard so repeated calls init once (§4.2). */
let wasmInited = false;

/** Initialize the resvg WASM engine once per process from the inlined bytes. */
async function ensureWasm(): Promise<void> {
  if (wasmInited) return;
  try {
    await initWasm(RESVG_WASM_BYTES);
  } catch (cause) {
    throw new DiagramPngError("PNG engine failed to initialize", messageOf(cause));
  }
  wasmInited = true;
}

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
 * `@resvg/resvg-wasm` (REQ-OUT-03). The embedded data-URI font (§3.6) means resvg
 * needs no system fonts — text renders identically to the SVG.
 *
 * @param svg - The final SVG markup (post `postProcess`, §3). MUST carry explicit
 *   `width`/`height`/`viewBox` (REQ-OUT-02) so resvg sizes the raster correctly.
 * @param opts - Optional scale (default `DEFAULT_PNG_SCALE`).
 * @returns PNG file bytes as a `Uint8Array` (caller writes them; 05 §3).
 * @throws {DiagramPngError} (code `PNG_FAILED`, exit 5) if rasterization fails — the
 *   underlying resvg message is wrapped into `detail`. No partial bytes.
 */
export async function renderPng(svg: string, opts?: RenderPngOptions): Promise<Uint8Array> {
  const scale = opts?.scale ?? DEFAULT_PNG_SCALE;

  await ensureWasm();

  let resvg: InstanceType<typeof Resvg>;
  try {
    resvg = new Resvg(svg, {
      // #12: resvg does NOT parse the SVG's embedded `@font-face` data-URI, so the
      // glyphs MUST be supplied as a font buffer or every label renders blank.
      // We pass the DiagramSans subset as TTF (resvg-wasm doesn't reliably accept
      // WOFF2) and still never touch system fonts.
      font: {
        loadSystemFonts: false,
        fontBuffers: [FONT_BUFFER_BYTES],
        defaultFontFamily: "DiagramSans",
      },
      fitTo: { mode: "zoom", value: scale },
    });
  } catch (cause) {
    throw new DiagramPngError("PNG rasterization rejected the SVG", messageOf(cause));
  }

  // Intrinsic SVG dimensions (px), read from the SVG markup itself.
  const intrinsicWidth = resvg.width;
  const intrinsicHeight = resvg.height;

  let png: { asPng(): Uint8Array; width: number; height: number };
  try {
    png = resvg.render();
  } catch (cause) {
    throw new DiagramPngError("PNG rasterization failed", messageOf(cause));
  }

  let bytes: Uint8Array;
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
