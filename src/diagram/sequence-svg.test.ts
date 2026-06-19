import { describe, it, expect } from "vitest";
import { DiagramRenderError } from "./errors.js";
import { DiagramSpec } from "./schema.js";
import { renderSequence } from "./sequence-svg.js";

/**
 * Build a minimal valid sequence `DiagramSpec`. Goes through `DiagramSpec.parse`
 * so `Message.kind` defaults are applied exactly as the real pipeline sees them.
 */
function seqSpec(
  participants: { id: string; label: string; role?: string }[],
  messages: Record<string, unknown>[],
): DiagramSpec {
  return DiagramSpec.parse({
    diagramType: "sequence",
    title: "Login",
    description: "A login sequence",
    participants,
    messages,
  });
}

describe("renderSequence — direct-SVG sequence layout (REQ-COV-02, OTQ-3)", () => {
  it("renders one lifeline per participant and one arrow per message in document order", () => {
    const spec = seqSpec(
      [
        { id: "u", label: "User" },
        { id: "s", label: "Server" },
      ],
      [
        { from: "u", to: "s", label: "request", kind: "sync" },
        { from: "s", to: "u", label: "response", kind: "reply" },
      ],
    );
    const { svg } = renderSequence(spec);
    // One lifeline per participant.
    expect(svg.match(/class="lifeline"/g)?.length).toBe(2);
    // One arrow (line or polyline with message class) per message.
    expect(svg.match(/class="message message-/g)?.length).toBe(2);
    // Document order: "request" label precedes "response" label.
    expect(svg.indexOf("request")).toBeLessThan(svg.indexOf("response"));
    // Header labels present.
    expect(svg).toContain("User");
    expect(svg).toContain("Server");
  });

  it("renders sync/async/reply messages with distinct arrow/line styles", () => {
    const spec = seqSpec(
      [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      [
        { from: "a", to: "b", label: "call", kind: "sync" },
        { from: "a", to: "b", label: "emit", kind: "async" },
        { from: "b", to: "a", label: "ack", kind: "reply" },
      ],
    );
    const { svg } = renderSequence(spec);
    // sync → closed/filled arrowhead.
    expect(svg).toContain("arrowhead-closed");
    // async/reply → open arrowhead.
    expect(svg).toContain("arrowhead-open");
    // reply → dashed line.
    expect(svg).toMatch(/message message-reply"[^>]*stroke-dasharray/);
    // sync/async lines are NOT dashed.
    expect(svg).toMatch(/message message-sync"(?![^>]*stroke-dasharray)/);
  });

  it("draws an activation bar on an activated target", () => {
    const spec = seqSpec(
      [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      [
        { from: "a", to: "b", label: "call", kind: "sync", activate: true },
        { from: "b", to: "a", label: "done", kind: "reply" },
      ],
    );
    const { svg } = renderSequence(spec);
    expect(svg).toContain('class="activation"');
  });

  it("renders a self-message (from === to) as a loop", () => {
    const spec = seqSpec(
      [{ id: "a", label: "A" }],
      [{ from: "a", to: "a", label: "recurse", kind: "sync" }],
    );
    const { svg } = renderSequence(spec);
    // Self-message uses a polyline loop and includes its label.
    expect(svg).toContain("recurse");
    expect(svg).toMatch(/<polyline class="message message-sync"/);
  });

  it("output SVG root has explicit viewBox, width, and height; labels are plain <text> with no <foreignObject>", () => {
    const spec = seqSpec(
      [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ],
      [{ from: "a", to: "b", label: "hi" }],
    );
    const { svg, width, height } = renderSequence(spec);
    expect(svg).toMatch(/^<svg/);
    expect(svg).toContain(`width="${width}"`);
    expect(svg).toContain(`height="${height}"`);
    expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
    expect(svg).toContain("<text");
    expect(svg).not.toContain("<foreignObject");
  });

  it("computes width/height from the layout (REQ-OUT-02)", () => {
    // 3 participants, 4 messages, one of which is a self-message → extra height.
    const spec = seqSpec(
      [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      [
        { from: "a", to: "b", label: "1", kind: "sync", activate: true },
        { from: "b", to: "b", label: "2", kind: "sync" }, // self-message
        { from: "b", to: "c", label: "3", kind: "async" },
        { from: "c", to: "a", label: "4", kind: "reply" },
      ],
    );
    const { width, height } = renderSequence(spec);
    // width = MARGIN*2 + HEADER_WIDTH + (n-1)*LIFELINE_GAP = 48 + 120 + 2*160 = 488
    expect(width).toBe(488);
    // height = MARGIN*2 + HEADER_HEIGHT + HEADER_TO_FIRST_MSG
    //   + 4*MESSAGE_ROW_HEIGHT + 1*SELF_MESSAGE_EXTRA
    //   = 48 + 36 + 28 + 192 + 24 = 328
    expect(height).toBe(328);
  });

  it("throws DiagramRenderError when called with a non-sequence spec", () => {
    const spec = DiagramSpec.parse({
      diagramType: "architecture",
      title: "T",
      description: "D",
      nodes: [{ id: "a", label: "A" }],
    });
    expect(() => renderSequence(spec)).toThrow(DiagramRenderError);
  });

  it("throws DiagramRenderError for an empty participants list", () => {
    const spec = DiagramSpec.parse({
      diagramType: "sequence",
      title: "T",
      description: "D",
      participants: [],
      messages: [],
    });
    expect(() => renderSequence(spec)).toThrow(DiagramRenderError);
  });
});
