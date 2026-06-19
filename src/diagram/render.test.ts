import { describe, it, expect } from "vitest";
import { render } from "./render.js";
import { parseSpec } from "./validate.js";
import { assertOutputValid } from "./validate.js";
import { DiagramInputError, DiagramOutputError } from "./errors.js";
import type { DiagramType } from "./schema.js";

// ===========================================================================
// Fixtures — one minimal valid spec per diagram type (parsed/validated).
// ===========================================================================

const architecture = {
  diagramType: "architecture",
  title: "Web App",
  description: "A minimal architecture diagram.",
  nodes: [
    { id: "web", label: "Web", role: "frontend" },
    { id: "db", label: "DB", role: "database" },
  ],
  edges: [{ from: "web", to: "db" }],
};

const flowchart = {
  diagramType: "flowchart",
  title: "Checkout Flow",
  description: "A minimal flowchart.",
  nodes: [
    { id: "start", label: "Start" },
    { id: "end", label: "End" },
  ],
  edges: [{ from: "start", to: "end" }],
};

const er = {
  diagramType: "er",
  title: "Order Model",
  description: "A minimal ER diagram.",
  nodes: [
    { id: "user", label: "User" },
    { id: "order", label: "Order" },
  ],
  edges: [{ from: "user", to: "order", label: "places" }],
};

const state = {
  diagramType: "state",
  title: "Door States",
  description: "A minimal state machine.",
  nodes: [
    { id: "open", label: "Open" },
    { id: "closed", label: "Closed" },
  ],
  edges: [{ from: "closed", to: "open", label: "unlock" }],
};

const dataflow = {
  diagramType: "dataflow",
  title: "Ingest Pipeline",
  description: "A minimal dataflow diagram.",
  nodes: [
    { id: "src", label: "Source" },
    { id: "sink", label: "Sink" },
  ],
  edges: [{ from: "src", to: "sink", label: "events" }],
};

const sequence = {
  diagramType: "sequence",
  title: "Login Flow",
  description: "A minimal sequence diagram.",
  participants: [
    { id: "user", label: "User" },
    { id: "api", label: "API" },
  ],
  messages: [{ from: "user", to: "api", label: "login" }],
};

const ALL_FIXTURES: Record<DiagramType, unknown> = {
  architecture,
  flowchart,
  er,
  state,
  dataflow,
  sequence,
};

// ===========================================================================
// End-to-end render for every diagram type
// ===========================================================================

describe("render — all six diagram types end-to-end", () => {
  for (const [type, fixture] of Object.entries(ALL_FIXTURES)) {
    it(`renders ${type} to a RenderResult whose svg passes assertOutputValid`, async () => {
      const spec = parseSpec(fixture);
      const result = await render(spec, { theme: "light" });

      // svg is a finished, tier-2-valid artifact.
      expect(result.svg).toMatch(/^<svg/);
      expect(() => assertOutputValid(result.svg)).not.toThrow();

      // RenderResult shape (00 §3.2).
      expect(result.theme).toBe("light");
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(typeof result.slug).toBe("string");
      expect(result.slug.length).toBeGreaterThan(0);
    });
  }
});

// ===========================================================================
// Dispatch — sequence vs graph path
// ===========================================================================

describe("render — dispatch", () => {
  it("sequence specs render one lifeline-style svg (sequence path)", async () => {
    const spec = parseSpec(sequence);
    const result = await render(spec, { theme: "light" });
    expect(result.svg).toContain("<svg");
    // Sequence path produces plain <text> labels (the message label).
    expect(result.svg).toContain("login");
  });

  it("graph specs render through the dot→graphviz path", async () => {
    const spec = parseSpec(architecture);
    const result = await render(spec, { theme: "light" });
    expect(result.svg).toContain("<svg");
  });
});

// ===========================================================================
// Dimensions + slug
// ===========================================================================

describe("render — dimensions and slug", () => {
  it("width/height match the SVG viewBox/attributes", async () => {
    const spec = parseSpec(architecture);
    const result = await render(spec, { theme: "light" });
    expect(result.svg).toContain(`width="${result.width}"`);
    expect(result.svg).toContain(`height="${result.height}"`);
  });

  it("slug is derived from the title", async () => {
    const spec = parseSpec(architecture);
    const result = await render(spec, { theme: "light" });
    expect(result.slug).toBe("web-app");
  });
});

// ===========================================================================
// Themes
// ===========================================================================

describe("render — themes", () => {
  it("both light and dark render to valid svg", async () => {
    const spec = parseSpec(architecture);
    const light = await render(spec, { theme: "light" });
    const dark = await render(spec, { theme: "dark" });
    expect(() => assertOutputValid(light.svg)).not.toThrow();
    expect(() => assertOutputValid(dark.svg)).not.toThrow();
    expect(light.theme).toBe("light");
    expect(dark.theme).toBe("dark");
    // Distinct theme tokens produce distinct svg.
    expect(light.svg).not.toBe(dark.svg);
  });
});

// ===========================================================================
// Validation placement (REQ-REL-01/02)
// ===========================================================================

describe("render — validation placement", () => {
  it("parseSpec at the boundary rejects an invalid spec with DiagramInputError", () => {
    // render() itself trusts a typed spec; the CLI boundary validates via parseSpec.
    const invalid = {
      diagramType: "architecture",
      title: "Bad",
      description: "Edge references a missing node.",
      nodes: [{ id: "a", label: "A" }],
      edges: [{ from: "a", to: "ghost" }],
    };
    expect(() => parseSpec(invalid)).toThrow(DiagramInputError);
  });

  it("a malformed output throws DiagramOutputError (asserted after post-process)", async () => {
    // assertOutputValid is the gate; confirm it is wired to throw on bad output.
    expect(() => assertOutputValid("<svg>not valid</svg")).toThrow(
      DiagramOutputError,
    );
  });
});
