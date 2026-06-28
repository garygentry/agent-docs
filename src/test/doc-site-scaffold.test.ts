/**
 * Scaffold-output goldens (10 §5). Applies a fixed interview-answer set to the REAL
 * references/templates/** and the documented scaffold-time mechanics (script merge,
 * sidebar.mjs emission, deploy-fragment selection, manifest/provenance generation) via
 * `finalScaffold`, and asserts the resolved FINAL TARGET TREE is byte-identical to
 * the checked-in __scaffold_golden__/<answer-set>/ tree (keyed by real target paths,
 * 10 §7). Proves the emit procedure is deterministic / agent-agnostic without a live
 * agent (REQ-PORT-02), and that declining every component emits ONLY the core
 * scaffold (REQ-USE-01).
 *
 * A thin `resolveTree` byte-stability guard over the raw template groups is kept as
 * a fast unit. NO Astro build runs here — that is the target-repo smoke test
 * (REQ-VERIFY-01), owned by 08-rerun-and-verification.md (doc-site-smoke.test.ts).
 */
import { describe, it, expect } from "vitest";

import {
  ANSWER_SETS,
  GROUPS,
  loadAnswers,
  readGoldenTree,
  resolveTree,
  type ScaffoldAnswers,
} from "./doc-site-scaffold.shared.js";
import { finalScaffold, loadPreexisting } from "./doc-site-final-scaffold.shared.js";

const scaffold = (name: string) =>
  finalScaffold(loadAnswers(`${name}.json`), loadPreexisting(name));

describe("scaffold final-tree goldens are deterministic (REQ-PORT-02 scaffolded output)", () => {
  for (const name of ANSWER_SETS) {
    it(`${name}: final target tree is byte-identical to its committed golden`, () => {
      const resolved = scaffold(name);
      const golden = readGoldenTree(name);

      for (const [rel, content] of golden) {
        expect(resolved.get(rel), `missing/changed: ${name}/${rel}`).toBe(content);
      }
      // Bidirectional set equality: a newly emitted file with no golden (or a
      // removed golden) MUST fail — this is what catches a leaked declined-group file.
      expect([...resolved.keys()].sort()).toEqual([...golden.keys()].sort());
    });

    it(`${name}: no unresolved {{TOKEN}} survives in the final tree`, () => {
      for (const [rel, content] of scaffold(name)) {
        expect(/\{\{[A-Z0-9_]+\}\}/.test(content), `unresolved token in ${name}/${rel}`).toBe(
          false,
        );
      }
    });

    it(`${name}: emit is idempotent (re-run yields a byte-identical tree + provenance, rerun.md §3)`, () => {
      const a = scaffold(name);
      const b = scaffold(name);
      expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
    });
  }
});

describe("decline-all invariant — minimal core-only site (REQ-USE-01, 00 §5)", () => {
  it("emits no optional-component artifacts when every optional component is declined", () => {
    const resolved = scaffold("decline-all");
    for (const rel of resolved.keys()) {
      expect(rel, `declined-component file leaked: ${rel}`).not.toMatch(
        /setup-docs|docs\.yml|vercel|netlify|check-docs|diagram-render|src\/diagrams|pnpm-workspace/,
      );
    }
    // No deploy / workspace artifacts at the repo root either (only provenance + docs pkg).
    expect([...resolved.keys()].some((r) => r.startsWith(".github/"))).toBe(false);
  });
});

describe("thin resolveTree byte-stability guard (fast unit)", () => {
  for (const name of ANSWER_SETS) {
    it(`${name}: raw-template substitution resolves every token and is deterministic`, () => {
      const a = resolveTree(loadAnswers(`${name}.json`));
      const b = resolveTree(loadAnswers(`${name}.json`));
      expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
      for (const [rel, content] of a) {
        expect(/\{\{[A-Z0-9_]+\}\}/.test(content), `unresolved token in raw template ${rel}`).toBe(
          false,
        );
      }
    });
  }
});

describe("monorepo root-file merge sources its bytes from the fragment templates (#22)", () => {
  // The pnpm path is golden-covered (monorepo-mixed). The npm fragment variant —
  // which carries `workspaces` and the npm-form passthrough scripts — has no golden
  // answer set, so exercise it directly to lock the npm branch + never-clobber.
  const npmMonorepo = (): ScaffoldAnswers => {
    const base = loadAnswers("monorepo-mixed.json");
    return { ...base, tokens: { ...base.tokens, PKG_MANAGER: "npm", RUNTIME: "node" } };
  };

  it("npm form: registers the docs workspace + npm-form passthrough scripts from the fragment", () => {
    const d = npmMonorepo().tokens.DOCS_PKG_DIR!;
    const merged = JSON.parse(
      finalScaffold(npmMonorepo(), {
        "package.json": JSON.stringify(
          { name: "widget", private: true, scripts: { build: "turbo run build" } },
          null,
          2,
        ),
      }).get("package.json")!,
    ) as { workspaces: string[]; scripts: Record<string, string> };

    expect(merged.workspaces).toContain(d);
    expect(merged.scripts["dev:docs"]).toBe(`npm run dev --workspace ${d}`);
    expect(merged.scripts["build:docs"]).toBe(`npm run build --workspace ${d}`);
    expect(merged.scripts.build).toBe("turbo run build"); // pre-existing key preserved
  });

  it("npm form: never-clobbers a user-edited passthrough script value", () => {
    const merged = JSON.parse(
      finalScaffold(npmMonorepo(), {
        "package.json": JSON.stringify(
          { name: "widget", private: true, scripts: { "dev:docs": "echo custom" } },
          null,
          2,
        ),
      }).get("package.json")!,
    ) as { scripts: Record<string, string> };

    expect(merged.scripts["dev:docs"]).toBe("echo custom");
  });
});

describe("template-group coverage (10 §6 item 1)", () => {
  it("every template group (01 §2.2) is exercised by at least one answer set", () => {
    const selected = new Set<string>();
    for (const name of ANSWER_SETS) {
      const sel = loadAnswers(`${name}.json`).selection;
      for (const g of GROUPS) if (g.emit(sel)) selected.add(g.dir);
    }
    const uncovered = GROUPS.map((g) => g.dir)
      .filter((d) => !selected.has(d))
      .sort();
    expect(uncovered, `template groups never exercised by an answer set`).toEqual([]);
  });
});
