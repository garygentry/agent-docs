import { instance } from "@viz-js/viz";
import { DiagramRenderError } from "./errors.js";

/**
 * Cached Graphviz-WASM instance. `@viz-js/viz`'s `instance()` resolves a `Viz`
 * whose `renderString(dot, { format, engine })` is synchronous once WASM is ready.
 * Memoized so repeated `renderGraph` calls in one process share one WASM module.
 */
let vizInstance: Awaited<ReturnType<typeof instance>> | null = null;

/**
 * Lazily initialize and return the memoized Graphviz-WASM instance. No network,
 * no filesystem — the WASM is bundled into the CLI (01 §2.1, REQ-OUT-04).
 */
async function getViz(): Promise<Awaited<ReturnType<typeof instance>>> {
  if (vizInstance === null) {
    vizInstance = await instance();
  }
  return vizInstance;
}

/**
 * Lay out a Graphviz DOT string and render it to **raw** SVG markup using the
 * `dot` engine via `@viz-js/viz` (Graphviz compiled to WebAssembly, running
 * entirely in-process — no system `dot` binary, no headless browser, and no
 * network at build or view time; REQ-OUT-04 / REQ-SEC-02). The returned SVG is
 * plain-`<text>` (REQ-OUT-01) but is NOT yet tier-2-complete: it still needs
 * `svg-postprocess.ts` (04 §3) to apply role color, embed the font, inject
 * `<title>`/`<desc>`/`role="img"`, and canonicalize for determinism. Output
 * validation (02 §3) runs after post-processing.
 *
 * @param dot - A Graphviz DOT source string from `emitDot` (§2).
 * @returns Raw Graphviz SVG markup (a single `<svg>…</svg>` document).
 * @throws {DiagramRenderError} (code `RENDER_FAILED`) if Graphviz rejects the DOT
 *   (syntax error, unresolved construct) — the underlying engine message is
 *   wrapped verbatim into `detail`.
 */
export async function renderGraph(dot: string): Promise<string> {
  const viz = await getViz();
  try {
    return viz.renderString(dot, { format: "svg", engine: "dot" });
  } catch (cause) {
    throw new DiagramRenderError(
      "Graphviz failed to render the diagram",
      cause instanceof Error ? cause.message : String(cause),
    );
  }
}
