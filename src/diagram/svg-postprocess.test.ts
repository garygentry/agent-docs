import { describe, expect, it } from "vitest";
import { emitDot } from "./dot-emit.js";
import { renderGraph } from "./graph-render.js";
import { renderSequence } from "./sequence-svg.js";
import { postProcess } from "./svg-postprocess.js";
import { assertOutputValid } from "./validate.js";
import { resolveTheme } from "./theme.js";
import type { DiagramSpec } from "./schema.js";

const archSpec: DiagramSpec = {
  diagramType: "architecture",
  title: "My System",
  description: "A small architecture diagram.",
  theme: "light",
  nodes: [
    { id: "web", label: "Web", role: "frontend" },
    { id: "api", label: "API", role: "backend" },
    { id: "db", label: "DB", role: "database" },
  ],
  edges: [
    { from: "web", to: "api", label: "calls" },
    { from: "api", to: "db", label: "reads" },
  ],
  containers: [{ id: "svc", label: "Services", children: ["api"] }],
  participants: [],
  messages: [],
};

const seqSpec: DiagramSpec = {
  diagramType: "sequence",
  title: "Login Flow",
  description: "A login sequence.",
  theme: "light",
  nodes: [],
  edges: [],
  containers: [],
  participants: [
    { id: "u", label: "User", role: "frontend" },
    { id: "s", label: "Server", role: "backend" },
  ],
  messages: [
    { from: "u", to: "s", label: "login", kind: "sync", activate: true },
    { from: "s", to: "u", label: "ok", kind: "reply" },
  ],
};

async function graphRaw(spec: DiagramSpec): Promise<string> {
  return renderGraph(emitDot(spec));
}

describe("postProcess — graph path", () => {
  it("inlines node fills per role with no external stylesheet/CSS link", async () => {
    const raw = await graphRaw(archSpec);
    const { svg } = postProcess(raw, {
      theme: "light",
      spec: archSpec,
      width: 0,
      height: 0,
    });
    const light = resolveTheme("light");
    // frontend + backend + database fills present, inlined.
    expect(svg).toContain(`fill="${light.roles.frontend.fill}"`);
    expect(svg).toContain(`fill="${light.roles.backend.fill}"`);
    expect(svg).toContain(`fill="${light.roles.database.fill}"`);
    // No external stylesheet link / no <link>.
    expect(svg).not.toContain("<link");
    expect(svg).not.toMatch(/url\(\s*["']?https?:/i);
  });

  it("injects role=img, <title> and <desc> sourced from the spec", async () => {
    const raw = await graphRaw(archSpec);
    const { svg } = postProcess(raw, {
      theme: "light",
      spec: archSpec,
      width: 0,
      height: 0,
    });
    expect(svg).toContain('role="img"');
    expect(svg).toContain(">My System</title>");
    expect(svg).toContain(">A small architecture diagram.</desc>");
  });

  it("embeds the font as a data-URI (no external href) and renders a legend", async () => {
    const raw = await graphRaw(archSpec);
    const { svg } = postProcess(raw, {
      theme: "light",
      embedFont: true,
      spec: archSpec,
      width: 0,
      height: 0,
    });
    expect(svg).toMatch(/@font-face\b[^}]*src:[^}]*url\(data:font\//);
    expect(svg).not.toMatch(/url\(\s*["']?https?:/i);
    expect(svg).toContain('class="legend"');
    expect(svg).toContain(">Frontend</text>");
  });

  it("orders edges before nodes (arrows behind boxes)", async () => {
    const raw = await graphRaw(archSpec);
    const { svg } = postProcess(raw, {
      theme: "light",
      spec: archSpec,
      width: 0,
      height: 0,
    });
    const firstEdge = svg.indexOf('class="edge"');
    const firstNode = svg.search(/class="[^"]*role-/);
    expect(firstEdge).toBeGreaterThan(-1);
    expect(firstNode).toBeGreaterThan(-1);
    expect(firstEdge).toBeLessThan(firstNode);
  });

  it("rounds coordinates to SVG_COORD_PRECISION and is byte-identical across runs", async () => {
    const raw = await graphRaw(archSpec);
    const a = postProcess(raw, { theme: "light", spec: archSpec, width: 0, height: 0 });
    const b = postProcess(raw, { theme: "light", spec: archSpec, width: 0, height: 0 });
    expect(a.svg).toBe(b.svg);
    // No coordinate carries more than 2 decimal places.
    expect(a.svg).not.toMatch(/\d+\.\d{3,}/);
  });

  it("produces SVG that passes assertOutputValid", async () => {
    const raw = await graphRaw(archSpec);
    const { svg } = postProcess(raw, {
      theme: "dark",
      spec: archSpec,
      width: 0,
      height: 0,
    });
    expect(() => assertOutputValid(svg)).not.toThrow();
  });

  it("derives a slug from the title and reports expanded dimensions", async () => {
    const raw = await graphRaw(archSpec);
    const res = postProcess(raw, { theme: "light", spec: archSpec, width: 0, height: 0 });
    expect(res.slug).toBe("my-system");
    expect(res.width).toBeGreaterThan(0);
    expect(res.height).toBeGreaterThan(0);
  });
});

describe("postProcess — sequence path", () => {
  it("finishes the sequence SVG and passes assertOutputValid", () => {
    const raw = renderSequence(seqSpec);
    const { svg, slug } = postProcess(raw.svg, {
      theme: "light",
      spec: seqSpec,
      width: raw.width,
      height: raw.height,
    });
    expect(() => assertOutputValid(svg)).not.toThrow();
    expect(svg).toContain('role="img"');
    expect(slug).toBe("login-flow");
  });

  it("is byte-identical across runs", () => {
    const raw = renderSequence(seqSpec);
    const a = postProcess(raw.svg, {
      theme: "dark",
      spec: seqSpec,
      width: raw.width,
      height: raw.height,
    });
    const b = postProcess(raw.svg, {
      theme: "dark",
      spec: seqSpec,
      width: raw.width,
      height: raw.height,
    });
    expect(a.svg).toBe(b.svg);
  });
});

describe("postProcess — accent + errors", () => {
  it("applies an accent override to edges", async () => {
    const raw = await graphRaw(archSpec);
    const { svg } = postProcess(raw, {
      theme: "light",
      accent: "#ff6600",
      spec: archSpec,
      width: 0,
      height: 0,
    });
    expect(svg).toContain('stroke="#ff6600"');
  });

  it("throws DiagramOutputError on malformed raw SVG", () => {
    expect(() =>
      postProcess("<svg><g></svg>", {
        theme: "light",
        spec: archSpec,
        width: 10,
        height: 10,
      }),
    ).toThrow(/well-formed XML/);
  });
});

describe("postProcess — shape fill styles (#fill)", () => {
  it("translucent emits fill-opacity 0.8 on role shapes and legend swatches", async () => {
    const raw = await graphRaw(archSpec);
    const { svg } = postProcess(raw, {
      theme: "light",
      fillStyle: "translucent",
      spec: archSpec,
      width: 0,
      height: 0,
    });
    const light = resolveTheme("light");
    expect(svg).toContain(`fill="${light.roles.frontend.fill}" fill-opacity="0.8"`);
    // Legend swatch for the non-default backend role also carries the opacity.
    expect(svg).toContain('fill-opacity="0.8"');
    expect((svg.match(/fill-opacity="0.8"/g) ?? []).length).toBeGreaterThan(1);
  });

  it("solid omits fill-opacity entirely", async () => {
    const raw = await graphRaw(archSpec);
    const { svg } = postProcess(raw, {
      theme: "light",
      spec: archSpec,
      fillStyle: "solid",
      width: 0,
      height: 0,
    });
    const light = resolveTheme("light");
    expect(svg).toContain(`fill="${light.roles.frontend.fill}"`);
    expect(svg).not.toContain("fill-opacity");
  });

  it("transparent yields outline-only role shapes (fill=none, stroke kept)", async () => {
    const raw = await graphRaw(archSpec);
    const { svg } = postProcess(raw, {
      theme: "light",
      spec: archSpec,
      fillStyle: "transparent",
      width: 0,
      height: 0,
    });
    const light = resolveTheme("light");
    expect(svg).not.toContain("fill-opacity");
    // Role fill removed, but the role stroke remains.
    expect(svg).not.toContain(`fill="${light.roles.frontend.fill}"`);
    expect(svg).toContain(`stroke="${light.roles.frontend.stroke}"`);
  });

  it("spec.fill is honored when no explicit override is passed", async () => {
    const solidSpec: DiagramSpec = { ...archSpec, fill: "solid" };
    const raw = await graphRaw(solidSpec);
    const { svg } = postProcess(raw, { theme: "light", spec: solidSpec, width: 0, height: 0 });
    expect(svg).not.toContain("fill-opacity");
  });

  it("output stays well-formed and tier-2 valid for every fill style", async () => {
    for (const fillStyle of ["translucent", "solid", "transparent"] as const) {
      const raw = await graphRaw(archSpec);
      const { svg } = postProcess(raw, {
        theme: "light",
        spec: archSpec,
        fillStyle,
        width: 0,
        height: 0,
      });
      expect(() => assertOutputValid(svg, fillStyle)).not.toThrow();
    }
  });
});

describe("postProcess — panel, cards, legend placement, font embedding", () => {
  it("defaults to an opaque rounded bordered panel backdrop", async () => {
    const raw = await graphRaw(archSpec);
    const { svg } = postProcess(raw, { theme: "dark", spec: archSpec, width: 0, height: 0 });
    const dark = resolveTheme("dark");
    // A backdrop rect painted the theme background, rounded, with a boundary border.
    expect(svg).toMatch(/<rect class="backdrop"[^>]*rx="14"/);
    expect(svg).toContain(`fill="${dark.background}"`);
    expect(svg).toMatch(/<rect class="backdrop"[^>]*stroke="/);
  });

  it("omits the backdrop entirely when background is transparent", async () => {
    const raw = await graphRaw(archSpec);
    const { svg } = postProcess(raw, {
      theme: "dark",
      background: "transparent",
      spec: archSpec,
      width: 0,
      height: 0,
    });
    expect(svg).not.toContain('class="backdrop"');
  });

  it("elevated cards (default) attach a drop-shadow filter; flat cards do not", async () => {
    const raw = await graphRaw(archSpec);
    const elevated = postProcess(raw, { theme: "light", spec: archSpec, width: 0, height: 0 }).svg;
    // The filter id is canonicalized to e-N; assert the shadow primitive exists and
    // a role shape references the filter.
    expect(elevated).toContain("feDropShadow");
    expect(elevated).toMatch(/filter="url\(#e-\d+\)"/);

    const flat = postProcess(raw, {
      theme: "light",
      cardStyle: "flat",
      spec: archSpec,
      width: 0,
      height: 0,
    }).svg;
    expect(flat).not.toContain("feDropShadow");
    expect(flat).not.toContain('filter="url(#');
  });

  it("legend=none omits the legend", async () => {
    const raw = await graphRaw(archSpec);
    const { svg } = postProcess(raw, {
      theme: "light",
      legend: "none",
      spec: archSpec,
      width: 0,
      height: 0,
    });
    expect(svg).not.toContain('class="legend"');
  });

  it("embed-font off references the system stack and embeds no data-URI face", async () => {
    const raw = await graphRaw(archSpec);
    const { svg } = postProcess(raw, {
      theme: "light",
      embedFont: false,
      spec: archSpec,
      width: 0,
      height: 0,
    });
    expect(svg).not.toMatch(/@font-face/);
    expect(svg).toContain("Segoe UI");
    // Still valid output when the embed-font invariant is waived for this run.
    expect(() => assertOutputValid(svg, undefined, false)).not.toThrow();
  });
});
