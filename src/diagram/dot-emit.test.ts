import { describe, it, expect } from "vitest";
import { DiagramSpec } from "./schema.js";
import { DiagramRenderError } from "./errors.js";
import { emitDot } from "./dot-emit.js";

/** Parse a raw spec object into a validated DiagramSpec (applies schema defaults). */
function spec(raw: unknown): DiagramSpec {
  return DiagramSpec.parse(raw);
}

/** A minimal architecture spec with two roles, a container, and an edge. */
const architecture = spec({
  diagramType: "architecture",
  title: "Web App",
  description: "A minimal architecture diagram.",
  nodes: [
    { id: "web", label: "Web App", role: "frontend" },
    { id: "api", label: "API", role: "backend" },
    { id: "db", label: "Postgres", role: "database", shape: "cylinder" },
  ],
  edges: [
    { from: "web", to: "api" },
    { from: "api", to: "db" },
  ],
  containers: [{ id: "edge", label: "Edge", children: ["web"] }],
});

describe("emitDot — tier-2 constraint (REQ-OUT-01)", () => {
  it("emits no HTML-like labels and no record shapes", () => {
    const dot = emitDot(architecture);
    expect(dot).not.toMatch(/label\s*=\s*</);
    expect(dot).not.toContain("shape=record");
    expect(dot).not.toContain("shape=Mrecord");
  });

  it("carries role as class and never bakes fill color", () => {
    const dot = emitDot(architecture);
    expect(dot).toContain('class="role-frontend"');
    expect(dot).toContain('class="role-backend"');
    expect(dot).not.toContain("fillcolor");
    expect(dot).not.toContain("style=filled");
  });

  it("defaults a node without a role to role-default", () => {
    const dot = emitDot(
      spec({
        diagramType: "architecture",
        title: "t",
        description: "d",
        nodes: [{ id: "n", label: "N" }],
      }),
    );
    expect(dot).toContain('class="role-default"');
  });
});

describe("emitDot — containers (§2.4)", () => {
  it("emits subgraph cluster_<id> enclosing its children", () => {
    const dot = emitDot(architecture);
    expect(dot).toContain('subgraph "cluster_edge" {');
    // The child node is declared inside the cluster block, before its close.
    const clusterStart = dot.indexOf('subgraph "cluster_edge"');
    const clusterEnd = dot.indexOf("}", clusterStart);
    expect(dot.slice(clusterStart, clusterEnd)).toContain('"web"');
  });

  it("nests child containers inside their parent", () => {
    const dot = emitDot(
      spec({
        diagramType: "architecture",
        title: "t",
        description: "d",
        nodes: [{ id: "n", label: "N" }],
        containers: [
          { id: "outer", label: "Outer", children: [] },
          { id: "inner", label: "Inner", parent: "outer", children: ["n"] },
        ],
      }),
    );
    const outer = dot.indexOf('subgraph "cluster_outer"');
    const inner = dot.indexOf('subgraph "cluster_inner"');
    expect(outer).toBeGreaterThanOrEqual(0);
    expect(inner).toBeGreaterThan(outer);
    // inner cluster's closing brace precedes outer's closing brace → nested.
    const innerClose = dot.indexOf("}", inner);
    const outerClose = dot.lastIndexOf("}", dot.lastIndexOf("}") - 1);
    expect(innerClose).toBeLessThan(outerClose);
  });
});

describe("emitDot — per-type mapping (§2.2)", () => {
  const graphTypes = ["architecture", "flowchart", "er", "state", "dataflow"] as const;
  const rankdirs: Record<(typeof graphTypes)[number], string> = {
    architecture: "rankdir=LR;",
    flowchart: "rankdir=TB;",
    er: "rankdir=LR;",
    state: "rankdir=TB;",
    dataflow: "rankdir=LR;",
  };

  for (const t of graphTypes) {
    it(`sets the correct rankdir for ${t}`, () => {
      const dot = emitDot(
        spec({
          diagramType: t,
          title: "t",
          description: "d",
          nodes: [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
          ],
          edges: [{ from: "a", to: "b" }],
        }),
      );
      expect(dot).toContain(rankdirs[t]);
    });
  }

  it("state defaults nodes to rounded boxes", () => {
    const dot = emitDot(
      spec({
        diagramType: "state",
        title: "t",
        description: "d",
        nodes: [{ id: "s", label: "S" }],
      }),
    );
    expect(dot).toContain("shape=box");
    expect(dot).toContain("style=rounded");
  });

  it("er defaults edges to undirected (dir=none)", () => {
    const dot = emitDot(
      spec({
        diagramType: "er",
        title: "t",
        description: "d",
        nodes: [
          { id: "a", label: "A" },
          { id: "b", label: "B" },
        ],
        edges: [{ from: "a", to: "b" }],
      }),
    );
    expect(dot).toContain("dir=none");
  });
});

describe("emitDot — escaping (§2.7)", () => {
  it("escapes quotes and backslashes in labels", () => {
    const dot = emitDot(
      spec({
        diagramType: "architecture",
        title: "t",
        description: "d",
        nodes: [{ id: "n", label: 'a "quote" and \\ slash' }],
      }),
    );
    expect(dot).toContain('label="a \\"quote\\" and \\\\ slash"');
  });
});

describe("emitDot — determinism (§2.6)", () => {
  it("produces byte-identical output across two emits", () => {
    expect(emitDot(architecture)).toBe(emitDot(architecture));
  });
});

describe("emitDot — defensive guards (§2.8)", () => {
  it("throws DiagramRenderError for a sequence spec", () => {
    const seq = spec({
      diagramType: "sequence",
      title: "t",
      description: "d",
      participants: [{ id: "a", label: "A" }],
      messages: [{ from: "a", to: "a", label: "m" }],
    });
    expect(() => emitDot(seq)).toThrow(DiagramRenderError);
  });
});
