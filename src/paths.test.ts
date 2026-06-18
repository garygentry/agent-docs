import { describe, expect, it } from "vitest";

import { confinePath, resolveWithin } from "./paths.js";
import { PathEscapeError } from "./errors.js";

const ROOT = "/repo/adapters";

describe("confinePath", () => {
  it("returns the resolved absolute path for an in-root relative candidate", () => {
    expect(confinePath(ROOT, "codex/skills/foo/foo.md")).toBe(
      `${ROOT}/codex/skills/foo/foo.md`,
    );
  });

  it("allows the root itself", () => {
    expect(confinePath(ROOT, ".")).toBe(ROOT);
  });

  it("allows an absolute candidate that is inside the root", () => {
    expect(confinePath(ROOT, `${ROOT}/a/b`)).toBe(`${ROOT}/a/b`);
  });

  it("throws PathEscapeError for a `../escape` relative path", () => {
    expect(() => confinePath(ROOT, "../escape")).toThrow(PathEscapeError);
  });

  it("throws PathEscapeError for an absolute path outside the root", () => {
    expect(() => confinePath(ROOT, "/etc/passwd")).toThrow(PathEscapeError);
  });

  it("throws PathEscapeError for an embedded `..` that climbs out", () => {
    expect(() => confinePath(ROOT, "cursor/../../etc/passwd")).toThrow(PathEscapeError);
  });

  it("carries the attempted (escaping) path on the error", () => {
    try {
      confinePath(ROOT, "../escape");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PathEscapeError);
      expect((err as PathEscapeError).attemptedPath).toBe("/repo/escape");
    }
  });

  it("does not treat a sibling sharing a name prefix as in-root", () => {
    expect(() => confinePath("/repo/adapters", "/repo/adapters-evil/x")).toThrow(
      PathEscapeError,
    );
  });

  it("resolveWithin is an alias with identical semantics", () => {
    expect(resolveWithin).toBe(confinePath);
    expect(resolveWithin(ROOT, "a/b")).toBe(`${ROOT}/a/b`);
    expect(() => resolveWithin(ROOT, "../escape")).toThrow(PathEscapeError);
  });
});
