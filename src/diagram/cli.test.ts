import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { Readable } from "node:stream";

import { main, parseArgs, resolveOutputPaths } from "./cli.js";
import { DiagramUsageError } from "./errors.js";
import { CONTRACT_VERSION, type RenderResult } from "./schema.js";

// ===========================================================================
// Fixtures
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

// ===========================================================================
// Capture helpers for stdout / stderr.
// ===========================================================================

let stdout = "";
let stderr = "";
let stdoutSpy: { mockRestore(): void };
let stderrSpy: { mockRestore(): void };

const append =
  (sink: "out" | "err") =>
  (chunk: string | Uint8Array): boolean => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    if (sink === "out") stdout += text;
    else stderr += text;
    return true;
  };

beforeEach(() => {
  stdout = "";
  stderr = "";
  stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(append("out") as typeof process.stdout.write);
  stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(append("err") as typeof process.stderr.write);
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

/** Feed `text` as process.stdin for one `main` call. */
function withStdin(text: string): () => void {
  const original = Object.getOwnPropertyDescriptor(process, "stdin");
  const fake = Readable.from([Buffer.from(text, "utf8")]);
  Object.defineProperty(process, "stdin", {
    value: fake,
    configurable: true,
  });
  return () => {
    if (original) Object.defineProperty(process, "stdin", original);
  };
}

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "diagram-cli-"));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

// ===========================================================================
// parseArgs
// ===========================================================================

describe("parseArgs", () => {
  it("parses every flag and the stdin sentinel", () => {
    const a = parseArgs([
      "spec.json",
      "--type",
      "flowchart",
      "--theme",
      "dark",
      "--accent",
      "#2563eb",
      "--format",
      "both",
      "--out-dir",
      "out",
      "--out-name",
      "base",
    ]);
    expect(a.inputPath).toBe("spec.json");
    expect(a.fromStdin).toBe(false);
    expect(a.type).toBe("flowchart");
    expect(a.theme).toBe("dark");
    expect(a.accent).toBe("#2563eb");
    expect(a.format).toBe("both");
    expect(a.outDir).toBe("out");
    expect(a.outName).toBe("base");
  });

  it("recognizes '-' as stdin and defaults format to svg", () => {
    const a = parseArgs(["-"]);
    expect(a.fromStdin).toBe(true);
    expect(a.format).toBe("svg");
  });

  it("parses --version without requiring input", () => {
    const a = parseArgs(["--version"]);
    expect(a.version).toBe(true);
  });

  it.each([
    ["unknown flag", ["spec.json", "--bogus"]],
    ["missing input", ["--theme", "dark"]],
    ["bad accent", ["spec.json", "--accent", "red"]],
    ["bad type", ["spec.json", "--type", "bogus"]],
    ["bad theme", ["spec.json", "--theme", "neon"]],
    ["bad format", ["spec.json", "--format", "gif"]],
    ["out-file with out-dir", ["spec.json", "--out-file", "a.svg", "--out-dir", "d"]],
    ["out-file with out-name", ["spec.json", "--out-file", "a.svg", "--out-name", "n"]],
    ["out-name without out-dir", ["spec.json", "--out-name", "n"]],
    ["two inputs", ["a.json", "b.json"]],
    ["flag missing value", ["spec.json", "--type"]],
  ])("rejects %s with DiagramUsageError", (_label, argv) => {
    expect(() => parseArgs(argv)).toThrow(DiagramUsageError);
  });
});

// ===========================================================================
// resolveOutputPaths
// ===========================================================================

describe("resolveOutputPaths", () => {
  const result: RenderResult = {
    svg: "<svg/>",
    width: 10,
    height: 10,
    theme: "light",
    slug: "web-app",
  };

  it("honors --out-file (highest precedence) and swaps extension per format", () => {
    const args = parseArgs(["spec.json", "--out-file", "build/arch.svg"]);
    expect(resolveOutputPaths(args, result, "svg")).toEqual({ svg: "build/arch.svg" });
    expect(resolveOutputPaths(args, result, "png")).toEqual({ png: "build/arch.png" });
  });

  it("uses --out-dir + --out-name when no --out-file", () => {
    const args = parseArgs(["spec.json", "--out-dir", "d", "--out-name", "n"]);
    expect(resolveOutputPaths(args, result, "svg")).toEqual({ svg: `d${sep}n.svg` });
  });

  it("derives <slug>.<theme>.<ext> from --out-dir alone", () => {
    const args = parseArgs(["spec.json", "--out-dir", "d"]);
    expect(resolveOutputPaths(args, result, "svg")).toEqual({
      svg: `d${sep}web-app.light.svg`,
    });
  });

  it("returns stdout for svg with no target", () => {
    const args = parseArgs(["-"]);
    expect(resolveOutputPaths(args, result, "svg")).toBe("stdout");
  });

  it("refuses png to stdout with DiagramUsageError", () => {
    const args = parseArgs(["-"]);
    expect(() => resolveOutputPaths(args, result, "png")).toThrow(DiagramUsageError);
  });
});

// ===========================================================================
// main — input forms
// ===========================================================================

describe("main — input forms", () => {
  it("reads a spec from a file path and writes the SVG to stdout", async () => {
    const p = join(workDir, "spec.json");
    await writeFile(p, JSON.stringify(architecture));
    const code = await main([p]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/^<svg/);
  });

  it("reads a spec from stdin ('-')", async () => {
    const restore = withStdin(JSON.stringify(architecture));
    try {
      const code = await main(["-"]);
      expect(code).toBe(0);
      expect(stdout).toMatch(/^<svg/);
    } finally {
      restore();
    }
  });

  it("file path and stdin produce identical SVG", async () => {
    const p = join(workDir, "spec.json");
    await writeFile(p, JSON.stringify(architecture));
    await main([p]);
    const fromFile = stdout;

    stdout = "";
    const restore = withStdin(JSON.stringify(architecture));
    try {
      await main(["-"]);
    } finally {
      restore();
    }
    expect(stdout).toBe(fromFile);
  });

  it("--type overrides spec.diagramType (and disagreement fails as input error)", async () => {
    // architecture spec forced to sequence → cross-field validation rejects it.
    const p = join(workDir, "spec.json");
    await writeFile(p, JSON.stringify(architecture));
    const code = await main([p, "--type", "sequence"]);
    expect(code).toBe(2); // INPUT_INVALID
  });
});

// ===========================================================================
// main — formats, themes, naming
// ===========================================================================

describe("main — formats and output paths", () => {
  it("--format svg writes <slug>.<theme>.svg into --out-dir", async () => {
    const p = join(workDir, "spec.json");
    await writeFile(p, JSON.stringify(architecture));
    const code = await main([p, "--out-dir", workDir, "--theme", "dark"]);
    expect(code).toBe(0);
    const files = await readdir(workDir);
    expect(files).toContain("web-app.dark.svg");
  });

  it("--out-file writes exactly that path", async () => {
    const p = join(workDir, "spec.json");
    await writeFile(p, JSON.stringify(architecture));
    const target = join(workDir, "arch.svg");
    const code = await main([p, "--out-file", target]);
    expect(code).toBe(0);
    const body = await readFile(target, "utf8");
    expect(body).toMatch(/^<svg/);
  });

  it("--format both with --out-file writes .svg + .png", async () => {
    const p = join(workDir, "spec.json");
    await writeFile(p, JSON.stringify(architecture));
    const target = join(workDir, "arch.svg");
    const code = await main([p, "--out-file", target, "--format", "both"]);
    expect(code).toBe(0);
    const svg = await readFile(join(workDir, "arch.svg"), "utf8");
    expect(svg).toMatch(/^<svg/);
    const png = await readFile(join(workDir, "arch.png"));
    expect(png.subarray(0, 4)).toEqual(PNG_MAGIC);
  });

  it("--format png with --out-dir writes a PNG with the derived name", async () => {
    const p = join(workDir, "spec.json");
    await writeFile(p, JSON.stringify(sequence));
    const code = await main([p, "--format", "png", "--out-dir", workDir]);
    expect(code).toBe(0);
    const png = await readFile(join(workDir, "login-flow.light.png"));
    expect(png.subarray(0, 4)).toEqual(PNG_MAGIC);
  });
});

// ===========================================================================
// main — --version
// ===========================================================================

describe("main — --version", () => {
  it("prints CONTRACT_VERSION and returns 0", async () => {
    const code = await main(["--version"]);
    expect(code).toBe(0);
    expect(stdout).toBe(`${CONTRACT_VERSION}\n`);
  });
});

// ===========================================================================
// main — error classes and exit codes
// ===========================================================================

describe("main — exit codes", () => {
  it("bad flags → 64 (USAGE_ERROR)", async () => {
    const code = await main(["--nope"]);
    expect(code).toBe(64);
    expect(stderr).toMatch(/DiagramUsageError/);
  });

  it("missing input file → 6 (IO_ERROR)", async () => {
    const code = await main([join(workDir, "missing.json")]);
    expect(code).toBe(6);
    expect(stderr).toMatch(/DiagramIoError/);
  });

  it("invalid JSON → 2 (INPUT_INVALID), no file written", async () => {
    const p = join(workDir, "bad.json");
    await writeFile(p, "{ not json");
    const code = await main([p, "--out-dir", workDir]);
    expect(code).toBe(2);
    const files = await readdir(workDir);
    expect(files).toEqual(["bad.json"]);
  });

  it("structurally invalid spec → 2 (INPUT_INVALID), no artifact", async () => {
    const p = join(workDir, "spec.json");
    await writeFile(p, JSON.stringify({ ...architecture, edges: [{ from: "web", to: "ghost" }] }));
    const code = await main([p, "--out-dir", workDir]);
    expect(code).toBe(2);
    const files = await readdir(workDir);
    expect(files).toEqual(["spec.json"]);
  });

  it("png with no output target → 64 (USAGE_ERROR), no binary on stdout", async () => {
    const restore = withStdin(JSON.stringify(architecture));
    try {
      const code = await main(["-", "--format", "png"]);
      expect(code).toBe(64);
      expect(stderr).toMatch(/DiagramUsageError/);
      expect(stdout).toBe("");
    } finally {
      restore();
    }
  });
});

// ===========================================================================
// main — path confinement (REQ-SEC-01)
// ===========================================================================

describe("main — path confinement", () => {
  it("refuses to write outside --out-dir via a '..'-laden --out-name (IO_ERROR)", async () => {
    const p = join(workDir, "spec.json");
    await writeFile(p, JSON.stringify(architecture));
    const code = await main([p, "--out-dir", join(workDir, "nested"), "--out-name", "../escape"]);
    expect(code).toBe(6);
    expect(stderr).toMatch(/DiagramIoError/);
  });
});
