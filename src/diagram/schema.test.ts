import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import {
  DiagramSpec,
  CONTRACT_VERSION,
  EXIT_CODES,
  DEFAULT_FORMAT,
  DEFAULT_THEME,
  SVG_COORD_PRECISION,
} from "./schema.js";

/** A minimal valid architecture (graph-shaped) spec. */
const minimalArchitecture = {
  diagramType: "architecture",
  title: "Web App",
  description: "A minimal architecture diagram.",
  nodes: [{ id: "web", label: "Web" }],
};

/** A minimal valid sequence spec. */
const minimalSequence = {
  diagramType: "sequence",
  title: "Login Flow",
  description: "A minimal sequence diagram.",
  participants: [
    { id: "user", label: "User" },
    { id: "api", label: "API" },
  ],
  messages: [{ from: "user", to: "api", label: "login" }],
};

describe("DiagramSpec", () => {
  it("accepts a minimal valid architecture spec", () => {
    const parsed = DiagramSpec.parse(minimalArchitecture);
    expect(parsed.diagramType).toBe("architecture");
    // Defaults are applied.
    expect(parsed.theme).toBe("light");
    expect(parsed.edges).toEqual([]);
    expect(parsed.participants).toEqual([]);
  });

  it("accepts a minimal valid sequence spec", () => {
    const parsed = DiagramSpec.parse(minimalSequence);
    expect(parsed.diagramType).toBe("sequence");
    expect(parsed.participants).toHaveLength(2);
    expect(parsed.messages[0]?.kind).toBe("sync"); // default applied
  });

  it("rejects an unknown top-level key via .strict()", () => {
    expect(() => DiagramSpec.parse({ ...minimalArchitecture, node: [] })).toThrow(ZodError);
  });

  it("rejects a bad accent value '#abc'", () => {
    expect(() => DiagramSpec.parse({ ...minimalArchitecture, accent: "#abc" })).toThrow(ZodError);
  });

  it("rejects a bad accent value 'red'", () => {
    expect(() => DiagramSpec.parse({ ...minimalArchitecture, accent: "red" })).toThrow(ZodError);
  });

  it("accepts a valid #rrggbb accent", () => {
    expect(DiagramSpec.parse({ ...minimalArchitecture, accent: "#1a2b3c" }).accent).toBe("#1a2b3c");
  });
});

describe("constants", () => {
  it("CONTRACT_VERSION is 1.1.0", () => {
    expect(CONTRACT_VERSION).toBe("1.1.0");
  });

  it("EXIT_CODES has the six mappings exactly as specified", () => {
    expect(EXIT_CODES).toEqual({
      INPUT_INVALID: 2,
      RENDER_FAILED: 3,
      OUTPUT_INVALID: 4,
      PNG_FAILED: 5,
      IO_ERROR: 6,
      USAGE_ERROR: 64,
    });
  });

  it("exposes the other contract defaults", () => {
    expect(DEFAULT_FORMAT).toBe("svg");
    expect(DEFAULT_THEME).toBe("light");
    expect(SVG_COORD_PRECISION).toBe(2);
  });
});
