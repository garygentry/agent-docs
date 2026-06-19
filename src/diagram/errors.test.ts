import { describe, it, expect } from "vitest";
import { EXIT_CODES } from "./schema.js";
import {
  DiagramError,
  DiagramInputError,
  DiagramRenderError,
  DiagramOutputError,
  DiagramPngError,
  DiagramIoError,
  DiagramUsageError,
} from "./errors.js";

describe("error hierarchy", () => {
  const cases = [
    { Cls: DiagramInputError, code: "INPUT_INVALID" as const },
    { Cls: DiagramRenderError, code: "RENDER_FAILED" as const },
    { Cls: DiagramOutputError, code: "OUTPUT_INVALID" as const },
    { Cls: DiagramPngError, code: "PNG_FAILED" as const },
    { Cls: DiagramIoError, code: "IO_ERROR" as const },
    { Cls: DiagramUsageError, code: "USAGE_ERROR" as const },
  ];

  it("each subclass sets a distinct code and the matching EXIT_CODES exitCode", () => {
    const seen = new Set<string>();
    for (const { Cls, code } of cases) {
      const err = new Cls("boom", "some-detail");
      expect(err.code).toBe(code);
      expect(err.exitCode).toBe(EXIT_CODES[code]);
      expect(seen.has(code)).toBe(false);
      seen.add(code);
    }
    expect(seen.size).toBe(6);
  });

  it("DiagramError is the common base of every subclass", () => {
    for (const { Cls } of cases) {
      const err = new Cls("boom");
      expect(err).toBeInstanceOf(DiagramError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("carries message and optional detail", () => {
    const err = new DiagramInputError("bad input", "/nodes/0/id");
    expect(err.message).toBe("bad input");
    expect(err.detail).toBe("/nodes/0/id");
    expect(new DiagramRenderError("oops").detail).toBeUndefined();
  });

  it("sets a distinct name per subclass", () => {
    expect(new DiagramInputError("x").name).toBe("DiagramInputError");
    expect(new DiagramUsageError("x").name).toBe("DiagramUsageError");
  });
});
