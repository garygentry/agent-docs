import { describe, it, expect } from "vitest";
import { DiagramRenderError } from "./errors.js";
import { renderGraph } from "./graph-render.js";

/** A minimal, well-formed DOT graph that Graphviz can lay out. */
const MINIMAL_DOT = `digraph {
  rankdir=LR;
  node [shape=box];
  a [label="A", class="role-frontend"];
  b [label="B", class="role-backend"];
  a -> b;
}`;

describe("renderGraph — DOT → SVG via @viz-js/viz (REQ-OUT-01)", () => {
  it("renders a valid DOT string to an SVG whose root element is <svg>", async () => {
    const svg = await renderGraph(MINIMAL_DOT);
    // The root element of the markup is <svg> (after the XML/doctype preamble
    // Graphviz emits). Strip the preamble and assert the first element is <svg>.
    const firstTag = svg.slice(svg.indexOf("<svg")).trimStart();
    expect(firstTag.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
    // Tier-2: plain <text>, no <foreignObject>.
    expect(svg).toContain("<text");
    expect(svg).not.toContain("<foreignObject");
  });

  it("throws DiagramRenderError for invalid/un-renderable DOT", async () => {
    await expect(renderGraph("this is not valid dot {{{")).rejects.toBeInstanceOf(
      DiagramRenderError,
    );
  });

  it("wraps the engine message into DiagramRenderError.detail", async () => {
    let caught: unknown;
    try {
      await renderGraph("digraph { a -> ");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DiagramRenderError);
    const e = caught as DiagramRenderError;
    expect(e.code).toBe("RENDER_FAILED");
    expect(typeof e.detail).toBe("string");
    expect((e.detail ?? "").length).toBeGreaterThan(0);
  });

  it("rendering the same DOT twice produces byte-identical SVG", async () => {
    const first = await renderGraph(MINIMAL_DOT);
    const second = await renderGraph(MINIMAL_DOT);
    expect(second).toBe(first);
  });
});
