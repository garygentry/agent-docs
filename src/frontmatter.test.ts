import { describe, it, expect } from "vitest";
import { parseFrontmatter, serializeFrontmatter } from "./frontmatter.js";
import { MalformedFrontmatterError } from "./errors.js";

const SRC = "fixtures/sample.md";

describe("parseFrontmatter", () => {
  it("returns an order-preserving Map + byte-preserved body", () => {
    const content =
      "---\n" +
      "name: summarize\n" +
      "description: Summarize the current document.\n" +
      "argument-hint: \"[path]\"\n" +
      "---\n" +
      "Body line one.\n\nBody line two with trailing spaces.   \n";
    const { frontmatter, body } = parseFrontmatter(content, SRC);

    expect([...frontmatter.keys()]).toEqual(["name", "description", "argument-hint"]);
    expect(frontmatter.get("name")).toBe("summarize");
    expect(frontmatter.get("description")).toBe("Summarize the current document.");
    expect(frontmatter.get("argument-hint")).toBe("[path]");
    // Body preserved byte-for-byte, including the trailing spaces and blank line.
    expect(body).toBe(
      "Body line one.\n\nBody line two with trailing spaces.   \n",
    );
  });

  it("preserves arbitrary author key order, not alphabetical", () => {
    const content = "---\nzebra: 1\napple: 2\nmango: 3\n---\nbody\n";
    const { frontmatter } = parseFrontmatter(content, SRC);
    expect([...frontmatter.keys()]).toEqual(["zebra", "apple", "mango"]);
  });

  it("throws MalformedFrontmatterError on a missing opening delimiter", () => {
    expect(() => parseFrontmatter("no frontmatter here\n", SRC)).toThrow(
      MalformedFrontmatterError,
    );
  });

  it("throws MalformedFrontmatterError on an unterminated block", () => {
    expect(() => parseFrontmatter("---\nname: x\nbody without close\n", SRC)).toThrow(
      MalformedFrontmatterError,
    );
  });

  it("throws MalformedFrontmatterError on invalid YAML", () => {
    expect(() => parseFrontmatter("---\nname: : : bad\n  - nope\n---\nbody\n", SRC)).toThrow(
      MalformedFrontmatterError,
    );
  });

  it("throws MalformedFrontmatterError when the block is not a mapping", () => {
    expect(() => parseFrontmatter("---\n- a\n- b\n---\nbody\n", SRC)).toThrow(
      MalformedFrontmatterError,
    );
  });

  it("populates sourcePath on the thrown error", () => {
    try {
      parseFrontmatter("not valid", SRC);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedFrontmatterError);
      expect((err as MalformedFrontmatterError).sourcePath).toBe(SRC);
    }
  });
});

describe("serializeFrontmatter", () => {
  it("round-trips: re-parsing preserves key order and body bytes", () => {
    const content =
      "---\n" +
      "name: docs-helper\n" +
      "description: Helps with docs.\n" +
      "metadata:\n" +
      "  argument-hint: \"[topic]\"\n" +
      "  allowed-tools:\n" +
      "    - Read\n" +
      "    - Write\n" +
      "---\n" +
      "The body of the doc.\nSecond line.\n";
    const { frontmatter, body } = parseFrontmatter(content, SRC);

    const serialized = serializeFrontmatter(frontmatter, body);
    const reparsed = parseFrontmatter(serialized, SRC);

    expect([...reparsed.frontmatter.keys()]).toEqual([...frontmatter.keys()]);
    expect(reparsed.body).toBe(body);
    // Nested metadata order also survives the round-trip.
    const meta = reparsed.frontmatter.get("metadata") as Map<string, unknown>;
    expect([...meta.keys()]).toEqual(["argument-hint", "allowed-tools"]);
  });

  it("honors insertion order, not sorted keys (YAML_OPTS sortKeys:false)", () => {
    const map = new Map<string, unknown>([
      ["zebra", 1],
      ["apple", 2],
      ["mango", 3],
    ]);
    const out = serializeFrontmatter(map, "body\n");
    expect(out).toBe("---\nzebra: 1\napple: 2\nmango: 3\n---\nbody\n");
  });

  it("produces byte-identical output across two calls", () => {
    const map = new Map<string, unknown>([
      ["name", "x"],
      ["description", "y"],
      ["metadata", new Map([["argument-hint", "[a]"]])],
    ]);
    const a = serializeFrontmatter(map, "body\n");
    const b = serializeFrontmatter(map, "body\n");
    expect(a).toBe(b);
  });
});
