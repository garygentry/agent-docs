import type { Background, DiagramSpec, HexColor, RenderResult, Theme } from "./schema.js";
import { assertOutputValid } from "./validate.js"; // 02 §3
import { emitDot } from "./dot-emit.js"; // §2
import { renderGraph } from "./graph-render.js"; // §3
import { renderSequence } from "./sequence-svg.js"; // §4
import { postProcess } from "./svg-postprocess.js"; // 04 §3

/** Options that override `DiagramSpec` defaults for one render (theme baked per call). */
export interface RenderOptions {
  /** The theme variant to bake into this artifact (REQ-THEME-01). */
  theme: Theme;
  /** Optional accent/brand color override (validated `HexColor`); falls back to `spec.accent`. */
  accent?: HexColor;
  /** Optional canvas background override (#10); falls back to `spec.background`. */
  background?: Background;
  /** Optional uniform canvas padding in px (#15); falls back to the postprocess default. */
  padding?: number;
}

/**
 * Render one validated `DiagramSpec` into one theme variant as a tier-2-portable
 * SVG `RenderResult` (00 §3.2). This is the single orchestration entry the CLI
 * calls per theme. Flow: branch on `diagramType`
 * (`sequence` → `renderSequence` §4; else `emitDot`→`renderGraph` §2/§3) →
 * `postProcess` (04 §3: color, font, a11y, canonicalize) → `assertOutputValid`
 * (02 §3) → `RenderResult`. Input validation is NOT re-done here — the CLI already
 * validated the spec via `parseSpec` (02 §2 / 05 §3.1) before calling `render`.
 *
 * PNG is produced separately by the CLI via `png.ts` (04 §4) from `result.svg` —
 * this function never rasterizes (REQ-OUT-03 is owned downstream).
 *
 * @param spec - The engine-neutral diagram spec, already parsed AND validated by
 *   the CLI's `parseSpec` (02 §2); `render` trusts it as a typed `DiagramSpec`.
 * @param opts - `{ theme, accent? }` — the variant to bake (REQ-THEME-01).
 * @returns A `RenderResult` with validated `svg`, intrinsic `width`/`height`,
 *   the baked `theme`, and a `slug` (00 §3.2).
 * @throws {DiagramRenderError} If DOT/Graphviz or sequence layout fails (§3/§4, exit 3).
 * @throws {DiagramOutputError} If the post-processed SVG fails tier-2 / viewBox /
 *   font / a11y assertions (02 §3, exit 4).
 */
export async function render(spec: DiagramSpec, opts: RenderOptions): Promise<RenderResult> {
  // 1. Input already validated by the CLI via parseSpec (02 §2 / 05 §3.1);
  //    render trusts the typed DiagramSpec and does not re-validate (REQ-REL-01).

  // 2. Branch on diagram type.
  let rawSvg: string;
  let width: number;
  let height: number;
  if (spec.diagramType === "sequence") {
    const seq = renderSequence(spec);
    rawSvg = seq.svg;
    width = seq.width;
    height = seq.height;
  } else {
    const dot = emitDot(spec);
    rawSvg = await renderGraph(dot);
    // Graphviz sets width/height/viewBox on its <svg>; postProcess (04 §3) reads
    // and canonicalizes them and returns the authoritative dimensions.
    width = 0;
    height = 0;
  }

  // 3. Theme + a11y + font + canonicalization (04 §3). Returns the final SVG and
  //    its authoritative dimensions/slug.
  const post = postProcess(rawSvg, {
    theme: opts.theme,
    accent: opts.accent ?? spec.accent,
    background: opts.background ?? spec.background,
    padding: opts.padding,
    spec,
    width,
    height,
  });

  // 4. Output assertion (REQ-REL-01) — throws DiagramOutputError; nothing written.
  assertOutputValid(post.svg);

  // 5. Result.
  return {
    svg: post.svg,
    width: post.width,
    height: post.height,
    theme: opts.theme,
    slug: post.slug,
  };
}
