/**
 * Unit coverage for the Mintlify emit path (src/mintlify/*): the DocPlan/interview →
 * navigation builders, the docs.json assembler, and the structural validator. These are
 * pure functions — no scaffold golden harness, no CLI — so they pin the error-prone
 * adapter logic in isolation (mirrors how the Starlight content-plan mapping is tested).
 */
import { describe, expect, it } from "vitest";

import { buildDocsJson, serializeDocsJson } from "./emit.js";
import {
  buildNavigationFromPages,
  buildNavigationFromSections,
  buildTabbedNavigation,
  collectNavPagePaths,
  titleize,
} from "./navigation.js";
import { validateDocsJson } from "./validate.js";

describe("mintlify navigation — interview fallback (buildNavigationFromPages)", () => {
  it("groups multi-segment slugs by first segment and keeps single-segment slugs top-level", () => {
    const nav = buildNavigationFromPages([
      { slug: "intro" },
      { slug: "guides/setup" },
      { slug: "guides/recovery" },
      { slug: "reference/cli" },
    ]);
    expect(nav.pages).toEqual([
      "intro",
      { group: "Guides", pages: ["guides/setup", "guides/recovery"] },
      { group: "Reference", pages: ["reference/cli"] },
    ]);
  });

  it("preserves page order and fixes group order at first occurrence", () => {
    const nav = buildNavigationFromPages([{ slug: "b/one" }, { slug: "a/one" }, { slug: "b/two" }]);
    // All grouped ⇒ idiomatic top-level `groups`. Group "B" precedes "A" (b/one came
    // first); b/two joins the existing group.
    expect(nav.pages).toBeUndefined();
    expect(nav.groups).toEqual([
      { group: "B", pages: ["b/one", "b/two"] },
      { group: "A", pages: ["a/one"] },
    ]);
  });

  it("skips unmanaged pages", () => {
    const nav = buildNavigationFromPages([
      { slug: "guides/setup" },
      { slug: "legacy", unmanaged: true },
    ]);
    expect(collectNavPagePaths(nav)).toEqual(["guides/setup"]);
  });

  it("titleizes hyphenated segments", () => {
    expect(titleize("getting-started")).toBe("Getting Started");
    const nav = buildNavigationFromPages([{ slug: "getting-started/install" }]);
    expect(nav.groups![0]!.group).toBe("Getting Started");
  });

  it("uses the flat `pages` decorator when a loose top-level page is present", () => {
    const nav = buildNavigationFromPages([{ slug: "intro" }, { slug: "guides/setup" }]);
    expect(nav.groups).toBeUndefined();
    expect(nav.pages).toEqual(["intro", { group: "Guides", pages: ["guides/setup"] }]);
  });
});

describe("mintlify navigation — DocPlan-driven (buildNavigationFromSections / tabs)", () => {
  it("maps explicit sections 1:1 onto groups, preserving order and verbatim titles", () => {
    const nav = buildNavigationFromSections([
      { title: "Getting started", pages: ["get-started"] },
      { title: "Reference", pages: ["reference/client"] },
    ]);
    expect(nav.groups).toEqual([
      { group: "Getting started", pages: ["get-started"] },
      { group: "Reference", pages: ["reference/client"] },
    ]);
    // Single-segment page stays top-level inside its explicit group — no prefix rewrite
    // (the Starlight adapter needs one; Mintlify does not).
    expect(collectNavPagePaths(nav)).toEqual(["get-started", "reference/client"]);
  });

  it("renders scope:both as tabs (a structure Starlight cannot express)", () => {
    const nav = buildTabbedNavigation([
      { tab: "Documentation", sections: [{ title: "Guides", pages: ["guides/setup"] }] },
      { tab: "Architecture", sections: [{ title: "Overview", pages: ["arch/context"] }] },
    ]);
    expect(nav.tabs?.map((t) => t.tab)).toEqual(["Documentation", "Architecture"]);
    expect(collectNavPagePaths(nav)).toEqual(["guides/setup", "arch/context"]);
  });
});

describe("mintlify docs.json assembler (buildDocsJson / serializeDocsJson)", () => {
  const nav = buildNavigationFromSections([{ title: "Guides", pages: ["guides/setup"] }]);
  const input = {
    theme: "mint",
    name: "Acme",
    description: "Documentation for Acme",
    primary: "#3B82F6",
    light: "#93C5FD",
    dark: "#1D4ED8",
    githubUrl: "https://github.com/acme/acme",
    navigation: nav,
  };

  it("emits the canonical key order", () => {
    const docs = buildDocsJson(input);
    expect(Object.keys(docs)).toEqual([
      "$schema",
      "theme",
      "name",
      "description",
      "colors",
      "favicon",
      "navigation",
      "navbar",
      "footer",
    ]);
    expect(Object.keys(docs.colors as object)).toEqual(["primary", "light", "dark"]);
  });

  it("omits navbar/footer when no GitHub URL is given", () => {
    const docs = buildDocsJson({ ...input, githubUrl: "" });
    expect(docs.navbar).toBeUndefined();
    expect(docs.footer).toBeUndefined();
  });

  it("serializes deterministically (2-space indent, trailing newline, byte-stable)", () => {
    const a = serializeDocsJson(buildDocsJson(input));
    const b = serializeDocsJson(buildDocsJson(input));
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
    expect(a).toContain('  "theme": "mint"');
  });
});

describe("mintlify docs.json validator", () => {
  const okNav = buildNavigationFromSections([{ title: "Guides", pages: ["guides/setup"] }]);
  const okDocs = buildDocsJson({
    theme: "mint",
    name: "Acme",
    description: "d",
    primary: "#3B82F6",
    light: "#93C5FD",
    dark: "#1D4ED8",
    githubUrl: "",
    navigation: okNav,
  });

  it("accepts a well-formed docs.json whose nav pages all resolve", () => {
    const res = validateDocsJson(okDocs, new Set(["guides/setup"]));
    expect(res.ok, JSON.stringify(res.errors)).toBe(true);
  });

  it("flags a missing required key", () => {
    const res = validateDocsJson({ name: "x", navigation: okNav });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.code === "missing-required-key")).toBe(true);
  });

  it("flags a duplicate nav page path", () => {
    const nav = buildNavigationFromSections([
      { title: "A", pages: ["guides/setup"] },
      { title: "B", pages: ["guides/setup"] },
    ]);
    const res = validateDocsJson({ ...okDocs, navigation: nav });
    expect(res.errors.some((e) => e.code === "duplicate-nav-page")).toBe(true);
  });

  it("flags a nav page with no backing file", () => {
    const res = validateDocsJson(okDocs, new Set(["something/else"]));
    expect(res.errors.some((e) => e.code === "unresolved-nav-page")).toBe(true);
  });

  it("flags an empty navigation", () => {
    const res = validateDocsJson({ ...okDocs, navigation: { groups: [] } });
    expect(res.errors.some((e) => e.code === "empty-navigation")).toBe(true);
  });
});
