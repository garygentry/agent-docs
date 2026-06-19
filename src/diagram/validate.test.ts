import { describe, it, expect } from "vitest";
import {
  parseSpec,
  diagramSuperRefine,
  GRAPH_DIAGRAM_TYPES,
  assertOutputValid,
  assertWellFormed,
  assertTier2,
  assertStructural,
  assertFontPortable,
  assertA11y,
} from "./validate.js";
import { DiagramInputError, DiagramOutputError } from "./errors.js";

// ===========================================================================
// Fixtures
// ===========================================================================

/** A minimal valid architecture (graph-shaped) spec. */
const validArchitecture = {
  diagramType: "architecture",
  title: "Web App",
  description: "A minimal architecture diagram.",
  nodes: [
    { id: "web", label: "Web" },
    { id: "db", label: "DB" },
  ],
  edges: [{ from: "web", to: "db" }],
};

/** A minimal valid sequence spec. */
const validSequence = {
  diagramType: "sequence",
  title: "Login Flow",
  description: "A minimal sequence diagram.",
  participants: [
    { id: "user", label: "User" },
    { id: "api", label: "API" },
  ],
  messages: [{ from: "user", to: "api", label: "login" }],
};

/**
 * A fully valid, tier-2-portable SVG: explicit viewBox/width/height, plain
 * <text>, an embedded data-URI @font-face, and <title>/<desc>/role="img".
 */
const validSvg = `<svg xmlns="http://www.w3.org/2000/svg" role="img" viewBox="0 0 100 50" width="100" height="50">
  <title>Web App</title>
  <desc>A minimal architecture diagram.</desc>
  <style>@font-face { font-family: "Sub"; src: url(data:font/woff2;base64,AAAA) format("woff2"); }</style>
  <text x="10" y="20">Web</text>
</svg>`;

// ===========================================================================
// 2. Input validation — parseSpec / diagramSuperRefine
// ===========================================================================

describe("parseSpec — acceptance", () => {
  it("accepts a minimal valid architecture spec", () => {
    const spec = parseSpec(validArchitecture);
    expect(spec.diagramType).toBe("architecture");
    expect(spec.nodes).toHaveLength(2);
  });

  it("accepts a minimal valid sequence spec", () => {
    const spec = parseSpec(validSequence);
    expect(spec.diagramType).toBe("sequence");
    expect(spec.messages).toHaveLength(1);
  });
});

describe("parseSpec — referential integrity", () => {
  it("rejects an edge referencing a missing node id, naming the JSON path", () => {
    let err: unknown;
    try {
      parseSpec({
        diagramType: "flowchart",
        title: "Bad",
        description: "d",
        nodes: [{ id: "a", label: "A" }],
        edges: [{ from: "a", to: "ghost" }],
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DiagramInputError);
    expect((err as DiagramInputError).code).toBe("INPUT_INVALID");
    expect((err as DiagramInputError).detail).toContain("edges.0.to");
  });

  it("rejects a container child referencing a missing node id", () => {
    expect(() =>
      parseSpec({
        diagramType: "architecture",
        title: "Bad",
        description: "d",
        nodes: [{ id: "a", label: "A" }],
        containers: [{ id: "box", label: "Box", children: ["ghost"] }],
      }),
    ).toThrow(DiagramInputError);
    expect(
      detailOf(() =>
        parseSpec({
          diagramType: "architecture",
          title: "Bad",
          description: "d",
          nodes: [{ id: "a", label: "A" }],
          containers: [{ id: "box", label: "Box", children: ["ghost"] }],
        }),
      ),
    ).toContain("containers.0.children.0");
  });

  it("rejects a container.parent referencing a missing container id", () => {
    expect(
      detailOf(() =>
        parseSpec({
          diagramType: "architecture",
          title: "Bad",
          description: "d",
          nodes: [{ id: "a", label: "A" }],
          containers: [{ id: "box", label: "Box", children: ["a"], parent: "ghost" }],
        }),
      ),
    ).toContain("containers.0.parent");
  });

  it("rejects a message referencing a missing participant id", () => {
    expect(
      detailOf(() =>
        parseSpec({
          diagramType: "sequence",
          title: "Bad",
          description: "d",
          participants: [{ id: "user", label: "User" }],
          messages: [{ from: "user", to: "ghost", label: "x" }],
        }),
      ),
    ).toContain("messages.0.to");
  });
});

/** Run `fn`, expect it to throw a DiagramInputError, and return its `detail`. */
function detailOf(fn: () => unknown): string {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(DiagramInputError);
  return (err as DiagramInputError).detail ?? "";
}

describe("parseSpec — uniqueness & namespace collision", () => {
  it("rejects duplicate node ids, pathed at the second occurrence", () => {
    let err: unknown;
    try {
      parseSpec({
        diagramType: "flowchart",
        title: "Dup",
        description: "d",
        nodes: [
          { id: "a", label: "A" },
          { id: "a", label: "A2" },
        ],
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DiagramInputError);
    expect((err as DiagramInputError).detail).toContain("nodes.1.id");
  });

  it("rejects a node id and container id that collide", () => {
    let err: unknown;
    try {
      parseSpec({
        diagramType: "architecture",
        title: "Collide",
        description: "d",
        nodes: [{ id: "shared", label: "S" }],
        containers: [{ id: "shared", label: "C", children: ["shared"] }],
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DiagramInputError);
    expect((err as DiagramInputError).detail).toContain("containers.0.id");
    expect((err as DiagramInputError).detail).toMatch(/collide/i);
  });
});

describe("parseSpec — diagram-type ↔ field agreement (00 §2.5)", () => {
  it("rejects a sequence spec with non-empty nodes", () => {
    expect(() =>
      parseSpec({
        diagramType: "sequence",
        title: "Bad seq",
        description: "d",
        nodes: [{ id: "a", label: "A" }],
        participants: [{ id: "p", label: "P" }],
        messages: [{ from: "p", to: "p", label: "x" }],
      }),
    ).toThrow(DiagramInputError);
  });

  it("rejects a flowchart spec with empty nodes", () => {
    let err: unknown;
    try {
      parseSpec({
        diagramType: "flowchart",
        title: "Empty",
        description: "d",
        nodes: [],
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DiagramInputError);
    expect((err as DiagramInputError).detail).toMatch(/requires at least one node/);
  });

  it("aggregates all violations in one pass", () => {
    let err: unknown;
    try {
      parseSpec({
        diagramType: "flowchart",
        title: "Bad",
        description: "d",
        nodes: [
          { id: "a", label: "A" },
          { id: "a", label: "A2" },
        ],
        edges: [{ from: "a", to: "ghost" }],
      });
    } catch (e) {
      err = e;
    }
    const detail = (err as DiagramInputError).detail!;
    expect(detail).toContain("nodes.1.id");
    expect(detail).toContain("edges.0.to");
  });
});

describe("parseSpec — strict & per-field", () => {
  it("rejects an unknown top-level key", () => {
    expect(() => parseSpec({ ...validArchitecture, bogus: true })).toThrow(DiagramInputError);
  });

  it("rejects a malformed accent at parse", () => {
    expect(() => parseSpec({ ...validArchitecture, accent: "red" })).toThrow(DiagramInputError);
  });
});

describe("GRAPH_DIAGRAM_TYPES partition", () => {
  it("contains the five graph types and excludes sequence", () => {
    for (const t of ["architecture", "flowchart", "er", "state", "dataflow"] as const) {
      expect(GRAPH_DIAGRAM_TYPES.has(t)).toBe(true);
    }
    expect(GRAPH_DIAGRAM_TYPES.has("sequence")).toBe(false);
  });

  it("exports diagramSuperRefine as a function", () => {
    expect(typeof diagramSuperRefine).toBe("function");
  });
});

// ===========================================================================
// 3. Output assertions
// ===========================================================================

describe("assertOutputValid — acceptance", () => {
  it("passes a well-formed tier-2 SVG with title/desc/role=img/viewBox/embedded font", () => {
    expect(() => assertOutputValid(validSvg)).not.toThrow();
  });
});

describe("assertWellFormed", () => {
  it("throws DiagramOutputError on malformed XML", () => {
    expect(() => assertWellFormed("<svg><text>oops</svg>")).toThrow(DiagramOutputError);
  });

  it("returns a document with a root for valid XML", () => {
    const doc = assertWellFormed(validSvg);
    expect(doc.root?.name).toBe("svg");
  });
});

describe("assertTier2", () => {
  it("throws when <foreignObject> is present", () => {
    const svg = validSvg.replace(
      '<text x="10" y="20">Web</text>',
      "<foreignObject></foreignObject>",
    );
    expect(() => assertTier2(svg)).toThrow(DiagramOutputError);
  });

  it("throws when no <text> is present", () => {
    const svg = validSvg.replace('<text x="10" y="20">Web</text>', "");
    expect(() => assertTier2(svg)).toThrow(DiagramOutputError);
  });

  it("passes a clean tier-2 SVG", () => {
    expect(() => assertTier2(validSvg)).not.toThrow();
  });
});

describe("assertStructural", () => {
  it("throws on a missing viewBox", () => {
    const svg = validSvg.replace(' viewBox="0 0 100 50"', "");
    expect(() => assertStructural(svg, assertWellFormed(svg))).toThrow(DiagramOutputError);
  });

  it("throws on missing width/height", () => {
    const svg = validSvg.replace(' width="100" height="50"', "");
    expect(() => assertStructural(svg, assertWellFormed(svg))).toThrow(DiagramOutputError);
  });

  it("throws on a malformed (non-4-number) viewBox", () => {
    const svg = validSvg.replace('viewBox="0 0 100 50"', 'viewBox="0 0 100"');
    expect(() => assertStructural(svg, assertWellFormed(svg))).toThrow(/four well-formed numbers/);
  });

  it("throws when the root is not <svg>", () => {
    const svg = `<root viewBox="0 0 1 1" width="1" height="1"></root>`;
    expect(() => assertStructural(svg, assertWellFormed(svg))).toThrow(/root element is not/);
  });

  it("passes a structurally complete SVG", () => {
    expect(() => assertStructural(validSvg, assertWellFormed(validSvg))).not.toThrow();
  });
});

describe("assertFontPortable", () => {
  it("throws on an external font href", () => {
    const svg = validSvg.replace(
      "url(data:font/woff2;base64,AAAA)",
      "url(https://fonts.example.com/x.woff2)",
    );
    expect(() => assertFontPortable(svg)).toThrow(DiagramOutputError);
  });

  it("throws on an @import", () => {
    const svg = validSvg.replace("@font-face", "@import url(x.css); @font-face");
    expect(() => assertFontPortable(svg)).toThrow(DiagramOutputError);
  });

  it("throws when no embedded data-URI @font-face is present", () => {
    const svg = validSvg.replace(/<style>.*<\/style>/s, "");
    expect(() => assertFontPortable(svg)).toThrow(/no embedded data-URI/);
  });

  it("passes an embedded-face SVG", () => {
    expect(() => assertFontPortable(validSvg)).not.toThrow();
  });
});

describe("assertA11y", () => {
  it("throws on missing role=img", () => {
    const svg = validSvg.replace(' role="img"', "");
    expect(() => assertA11y(assertWellFormed(svg))).toThrow(/role="img"/);
  });

  it("throws on missing <title>", () => {
    const svg = validSvg.replace(/<title>.*<\/title>/, "");
    expect(() => assertA11y(assertWellFormed(svg))).toThrow(/missing <title>/);
  });

  it("throws on missing <desc>", () => {
    const svg = validSvg.replace(/<desc>.*<\/desc>/, "");
    expect(() => assertA11y(assertWellFormed(svg))).toThrow(/missing <desc>/);
  });

  it("passes an accessible SVG", () => {
    expect(() => assertA11y(assertWellFormed(validSvg))).not.toThrow();
  });
});

describe("assertOutputValid — reject paths", () => {
  it("throws DiagramOutputError for malformed XML", () => {
    expect(() => assertOutputValid("<svg><text>x</svg>")).toThrow(DiagramOutputError);
  });

  it("throws DiagramOutputError for a <foreignObject>", () => {
    const svg = validSvg.replace(
      '<text x="10" y="20">Web</text>',
      "<text>x</text><foreignObject/>",
    );
    expect(() => assertOutputValid(svg)).toThrow(DiagramOutputError);
  });

  it("throws DiagramOutputError for a missing viewBox", () => {
    const svg = validSvg.replace(' viewBox="0 0 100 50"', "");
    expect(() => assertOutputValid(svg)).toThrow(DiagramOutputError);
  });

  it("throws DiagramOutputError for an external font href", () => {
    const svg = validSvg.replace(
      "url(data:font/woff2;base64,AAAA)",
      "url(https://fonts.example.com/x.woff2)",
    );
    expect(() => assertOutputValid(svg)).toThrow(DiagramOutputError);
  });

  it("throws DiagramOutputError for a missing <title>", () => {
    const svg = validSvg.replace(/<title>.*<\/title>/, "");
    expect(() => assertOutputValid(svg)).toThrow(DiagramOutputError);
  });
});
