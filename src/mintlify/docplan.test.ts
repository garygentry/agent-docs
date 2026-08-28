/**
 * DocPlan → docs.json fixture coverage for the Mintlify nav adapter (docplan-adapter.md +
 * api-docs.md). The section/tab builders are unit-tested in isolation in mintlify.test.ts;
 * this suite drives a whole (small) DocPlan through `buildNavigationFromDocPlan` and on into
 * `buildDocsJson` / `validateDocsJson`, pinning the two Mintlify-unique shapes end-to-end:
 * `scope: both` → tabs, and a `type: api` source → a spec-driven tab with no page stubs.
 */
import { describe, expect, it } from "vitest";

import { buildDocsJson, serializeDocsJson } from "./emit.js";
import { type DocPlan, buildNavigationFromDocPlan, slugifyPath } from "./docplan.js";
import { collectNavPagePaths, collectOpenapiSpecs } from "./navigation.js";
import { validateDocsJson } from "./validate.js";

const docsFrom = (nav: ReturnType<typeof buildNavigationFromDocPlan>) =>
  buildDocsJson({
    theme: "mint",
    name: "Acme",
    description: "Documentation for Acme",
    primary: "#3B82F6",
    light: "#93C5FD",
    dark: "#1D4ED8",
    githubUrl: "",
    navigation: nav,
  });

describe("DocPlan → navigation — single family (flat groups)", () => {
  const plan: DocPlan = {
    scope: "end-user",
    grouping: [
      { title: "Getting started", documents: ["d1"], family: "diataxis" },
      { title: "Reference", documents: ["d2"], family: "diataxis" },
    ],
    documents: [
      { id: "d1", slug: "get-started", title: "Get started" },
      { id: "d2", slug: "reference/client", title: "Client" },
    ],
  };

  it("maps grouping 1:1 onto groups, preserving order and resolving page paths", () => {
    const nav = buildNavigationFromDocPlan(plan);
    expect(nav.tabs).toBeUndefined();
    expect(nav.groups).toEqual([
      { group: "Getting started", pages: ["get-started"] },
      { group: "Reference", pages: ["reference/client"] },
    ]);
  });

  it("assembles a docs.json that validates against its own page set", () => {
    const docs = docsFrom(buildNavigationFromDocPlan(plan));
    const res = validateDocsJson(docs, new Set(collectNavPagePaths(docs.navigation!)));
    expect(res.ok, JSON.stringify(res.errors)).toBe(true);
    expect(serializeDocsJson(docs).endsWith("\n")).toBe(true);
  });
});

describe("DocPlan → navigation — scope:both yields two tabs (Mintlify-unique)", () => {
  const plan: DocPlan = {
    scope: "both",
    grouping: [
      { title: "Guides", documents: ["g1"], family: "diataxis" },
      { title: "Overview", documents: ["a1"], family: "architecture" },
    ],
    documents: [
      { id: "g1", slug: "guides/setup", title: "Setup" },
      { id: "a1", slug: "arch/context", title: "Context" },
    ],
  };

  it("splits families into Documentation and Architecture tabs, order preserved", () => {
    const nav = buildNavigationFromDocPlan(plan);
    expect(nav.groups).toBeUndefined();
    expect(nav.tabs?.map((t) => t.tab)).toEqual(["Documentation", "Architecture"]);
    expect(nav.tabs?.[0]?.groups).toEqual([{ group: "Guides", pages: ["guides/setup"] }]);
    expect(nav.tabs?.[1]?.groups).toEqual([{ group: "Overview", pages: ["arch/context"] }]);
    expect(collectNavPagePaths(nav)).toEqual(["guides/setup", "arch/context"]);
  });
});

describe("DocPlan → navigation — OpenAPI source yields a spec tab with no page stubs", () => {
  const plan: DocPlan = {
    scope: "end-user",
    grouping: [{ title: "Guides", documents: ["g1"], family: "diataxis" }],
    documents: [{ id: "g1", slug: "guides/setup", title: "Setup" }],
    sources: [{ type: "api", path: "openapi.yaml" }],
    apiDocs: true,
  };

  it("promotes the flat guides into a Documentation tab and appends an API reference tab", () => {
    const nav = buildNavigationFromDocPlan(plan);
    expect(nav.tabs?.map((t) => t.tab)).toEqual(["Documentation", "API reference"]);
    const apiTab = nav.tabs?.find((t) => t.tab === "API reference");
    expect(apiTab?.openapi).toBe("openapi.yaml");
    // The API tab carries NO hand-authored page stubs (Mintlify generates them from the spec).
    expect(apiTab?.groups).toBeUndefined();
    expect(collectNavPagePaths(nav)).toEqual(["guides/setup"]); // only the guide, no endpoint stubs
    expect(collectOpenapiSpecs(nav)).toEqual(["openapi.yaml"]);
  });

  it("a spec-only nav is not flagged empty by the validator", () => {
    const docs = docsFrom(buildNavigationFromDocPlan(plan));
    const res = validateDocsJson(docs, new Set(collectNavPagePaths(docs.navigation!)));
    expect(res.ok, JSON.stringify(res.errors)).toBe(true);
    expect(res.errors.some((e) => e.code === "empty-navigation")).toBe(false);
  });

  it("apiDocs opt-in without a matching type:api source adds no tab", () => {
    const nav = buildNavigationFromDocPlan({ ...plan, sources: [{ type: "guide", path: "x.md" }] });
    // No api source ⇒ single family stays a flat group list (no forced tabs).
    expect(nav.tabs).toBeUndefined();
    expect(nav.groups?.map((g) => g.group)).toEqual(["Guides"]);
  });
});

describe("DocPlan page-path resolution (slug ?? path ?? id)", () => {
  it("slugifies a path (drop extension, lowercase, spaces/underscores → hyphens)", () => {
    expect(slugifyPath("docs/Getting_Started.md")).toBe("docs/getting-started");
    expect(slugifyPath("/Guides/My Page.mdx")).toBe("guides/my-page");
  });

  it("falls back path→id, drops unknown ids, and de-dups colliding paths within a group", () => {
    const nav = buildNavigationFromDocPlan({
      scope: "end-user",
      grouping: [{ title: "G", documents: ["a", "b", "ghost", "c"], family: "diataxis" }],
      documents: [
        { id: "a", path: "guide.md", title: "A" }, // path fallback → "guide"
        { id: "b", slug: "guide", title: "B" }, // collides with "a" → "guide-2"
        { id: "c", title: "How To" }, // no slug/path → slugify(id) → "c"
      ],
    });
    // "ghost" has no backing document → dropped (validation owns that error, not the mapper).
    expect(nav.groups?.[0]?.pages).toEqual(["guide", "guide-2", "c"]);
  });
});
