/**
 * CLI contract tests (08 §7, item 018) — the contract-level half of the CLI
 * suite, complementing the per-flag unit tests in `cli.test.ts` (item 012).
 *
 * Drives `main(argv)` (05 §3) over the SHARED per-type fixtures (08 §7.2,
 * `fixtures.ts`) to prove the four frozen contract dimensions doc-site-plugin
 * pins against (CON-02, REQ-INV-04):
 *   - §7.4 every `--type` value renders, and every `DiagramError` class maps to
 *     its documented `EXIT_CODES` exit code (dimensions 3 + 4);
 *   - §7.5 `--version` prints `CONTRACT_VERSION` (REQ-INV-04);
 *   - §7.6 path confinement refuses an escaping write with the IO exit code
 *     (REQ-SEC-01);
 *   - §7.7 the committed bundle `.mjs` and the in-process `main()` produce
 *     equivalent artifacts.
 *
 * Exit-code expectations come from `EXIT_CODES` (00 §6), never re-spelled literals.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { main } from "./cli.js";
import { assertOutputValid } from "./validate.js";
import {
  DiagramError,
  DiagramInputError,
  DiagramRenderError,
  DiagramOutputError,
  DiagramPngError,
  DiagramIoError,
  DiagramUsageError,
} from "./errors.js";
import { EXIT_CODES, CONTRACT_VERSION } from "./schema.js";
import { FIXTURES, architectureFixture } from "./fixtures.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..", "..");
const bundlePath = resolve(repoRoot, "skills/diagram-generator/scripts/diagram-render.mjs");

// ---------------------------------------------------------------------------
// stdout/stderr capture + temp workspace
// ---------------------------------------------------------------------------

let stdout = "";
let stdoutSpy: { mockRestore(): void };
let stderrSpy: { mockRestore(): void };

beforeEach(() => {
  stdout = "";
  const sink =
    (capture: boolean) =>
    (chunk: string | Uint8Array): boolean => {
      if (capture) stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    };
  stdoutSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation(sink(true) as typeof process.stdout.write);
  stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(sink(false) as typeof process.stderr.write);
});
afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "diagram-contract-"));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeSpec(spec: unknown, name = "spec.json"): Promise<string> {
  const p = join(workDir, name);
  await writeFile(p, JSON.stringify(spec));
  return p;
}

// ===========================================================================
// §7.4 — invocable types: every --type renders, every --format works
// ===========================================================================

describe("CLI invocable types (08 §7.4, dimension 3)", () => {
  for (const fixture of FIXTURES) {
    const type = fixture.spec.diagramType;
    it(`--type ${type} renders to exit 0 (svg)`, async () => {
      const p = await writeSpec(fixture.spec);
      const code = await main([p, "--type", type, "--out-dir", workDir]);
      expect(code).toBe(0);
    });
  }

  for (const format of ["svg", "png", "both"] as const) {
    it(`--format ${format} writes the expected artifact(s)`, async () => {
      const p = await writeSpec(architectureFixture.spec);
      const code = await main([p, "--format", format, "--out-dir", workDir]);
      expect(code).toBe(0);
      const files = await readdir(workDir);
      const want =
        format === "svg"
          ? ["web-service.light.svg"]
          : format === "png"
            ? ["web-service.light.png"]
            : ["web-service.light.svg", "web-service.light.png"];
      for (const f of want) expect(files).toContain(f);
    });
  }
});

// ===========================================================================
// §7.4 — every DiagramError class maps to its documented EXIT_CODES entry
// ===========================================================================

describe("DiagramError exit-code mapping (08 §7.4, dimension 4)", () => {
  it.each([
    [DiagramInputError, "INPUT_INVALID"],
    [DiagramRenderError, "RENDER_FAILED"],
    [DiagramOutputError, "OUTPUT_INVALID"],
    [DiagramPngError, "PNG_FAILED"],
    [DiagramIoError, "IO_ERROR"],
    [DiagramUsageError, "USAGE_ERROR"],
  ] as const)("%s.exitCode === EXIT_CODES.%s", (Cls, code) => {
    const err = new Cls("x");
    expect(err).toBeInstanceOf(DiagramError);
    expect(err.code).toBe(code);
    expect(err.exitCode).toBe(EXIT_CODES[code]);
  });

  // OUTPUT_INVALID is proven at the validator boundary (08 §7.4 note): render never
  // emits a <foreignObject>, so feed a synthetic leak directly to assertOutputValid —
  // the same gate render.ts calls (03 §5) — and assert the mapped error/exit code.
  it("a <foreignObject> leak throws DiagramOutputError → exit OUTPUT_INVALID", () => {
    const leaky =
      '<svg xmlns="http://www.w3.org/2000/svg" role="img" viewBox="0 0 10 10" ' +
      'width="10" height="10"><title>x</title><desc>y</desc>' +
      "<foreignObject><div>nope</div></foreignObject></svg>";
    try {
      assertOutputValid(leaky);
      throw new Error("expected assertOutputValid to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(DiagramOutputError);
      expect((err as DiagramOutputError).exitCode).toBe(EXIT_CODES.OUTPUT_INVALID);
    }
  });

  // RENDER_FAILED has no cheap real trigger (Graphviz / sequence layout rarely fail on
  // a valid spec), so prove the WIRING end-to-end: a DiagramRenderError thrown by the
  // render layer must surface through main()'s catch as exit 3 — with no partial
  // artifact written. The render module is mocked only for this test (isolated via
  // resetModules + a dynamic cli import), so the rest of the suite uses the real render.
  it("a render-layer failure propagates through main() → exit RENDER_FAILED (3)", async () => {
    vi.resetModules();
    vi.doMock("./render.js", async () => {
      const { DiagramRenderError } = await import("./errors.js");
      return {
        render: async () => {
          throw new DiagramRenderError("forced render failure");
        },
      };
    });
    try {
      const { main: mainWithFailingRender } = await import("./cli.js");
      const p = await writeSpec(architectureFixture.spec);
      const code = await mainWithFailingRender([p, "--out-dir", workDir]);
      expect(code).toBe(EXIT_CODES.RENDER_FAILED);
      expect(await readdir(workDir)).toEqual(["spec.json"]); // no partial artifact
    } finally {
      vi.doUnmock("./render.js");
      vi.resetModules();
    }
  });
});

// ===========================================================================
// §7.5 — --version prints CONTRACT_VERSION
// ===========================================================================

describe("CLI --version (08 §7.5, REQ-INV-04)", () => {
  it("prints CONTRACT_VERSION and exits 0", async () => {
    const code = await main(["--version"]);
    expect(code).toBe(0);
    expect(stdout.trim()).toBe(CONTRACT_VERSION);
  });
});

// ===========================================================================
// §7.6 — path confinement (REQ-SEC-01)
// ===========================================================================

describe("CLI path confinement (08 §7.6, REQ-SEC-01)", () => {
  it("an --out-name escaping --out-dir is refused with IO_ERROR and writes nothing", async () => {
    const p = await writeSpec(architectureFixture.spec);
    const code = await main([p, "--out-dir", join(workDir, "nested"), "--out-name", "../escape"]);
    expect(code).toBe(EXIT_CODES.IO_ERROR);
    const escaped = resolve(workDir, "escape.svg");
    await expect(readFile(escaped)).rejects.toBeTruthy();
  });
});

// ===========================================================================
// §7.7 — in-process vs committed-bundle execution parity
// ===========================================================================

describe("in-process vs committed-bundle parity (08 §7.7, REQ-PORT-02)", () => {
  it("the bundle .mjs and in-process main() produce byte-identical SVG", async () => {
    const p = await writeSpec(architectureFixture.spec);

    // In-process render → file.
    const inProcDir = join(workDir, "inproc");
    const inCode = await main([p, "--out-dir", inProcDir, "--out-name", "out"]);
    expect(inCode).toBe(0);
    const inProc = await readFile(join(inProcDir, "out.svg"), "utf8");

    // Committed bundle render → file, spawned with no node_modules dependency.
    const bundleDir = join(workDir, "bundle");
    execFileSync("bun", [bundlePath, p, "--out-dir", bundleDir, "--out-name", "out"], {
      cwd: workDir,
      encoding: "utf-8",
    });
    const fromBundle = await readFile(join(bundleDir, "out.svg"), "utf8");

    expect(fromBundle).toBe(inProc);
  });
});
