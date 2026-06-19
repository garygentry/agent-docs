/**
 * Scaffold-output goldens (10 §5). Applies a fixed interview-answer set to the REAL
 * references/templates/** via the same mechanical {{TOKEN}} substitution the agent
 * performs (01 §2.1), and asserts the resolved tree is byte-identical to the
 * checked-in __scaffold_golden__/<answer-set>/ tree. Proves the substitution
 * procedure is deterministic / agent-agnostic without a live agent (REQ-PORT-02),
 * and that declining every component emits ONLY the core scaffold (REQ-USE-01, §5.4).
 *
 * NO Astro build runs here — that is the target-repo smoke test (REQ-VERIFY-01),
 * owned by 08-rerun-and-verification.md. See 10 §2.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, it, expect } from "vitest";

import {
  ANSWER_SETS,
  GROUPS,
  TEMPLATES_DIR,
  loadAnswers,
  readGoldenTree,
  resolveTree,
} from "./doc-site-scaffold.shared.js";

describe("scaffold-output goldens are deterministic (REQ-PORT-02 scaffolded output)", () => {
  for (const name of ANSWER_SETS) {
    it(`${name}: resolved tree is byte-identical to its committed golden`, () => {
      const resolved = resolveTree(loadAnswers(`${name}.json`));
      const golden = readGoldenTree(name);

      // Byte-exact per file.
      for (const [rel, content] of golden) {
        expect(resolved.get(rel), `missing/changed: ${name}/${rel}`).toBe(content);
      }
      // Bidirectional set equality: a newly emitted file with no golden (or a
      // removed golden) MUST fail — this is what catches a leaked declined-group file.
      expect([...resolved.keys()].sort()).toEqual([...golden.keys()].sort());
    });

    it(`${name}: substitution is idempotent / order-independent (deterministic)`, () => {
      const a = resolveTree(loadAnswers(`${name}.json`));
      const b = resolveTree(loadAnswers(`${name}.json`));
      expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
    });
  }
});

describe("decline-all invariant — zero files for declined components (REQ-USE-01, 00 §5)", () => {
  it("emits ONLY core-group files when every optional component is declined", () => {
    const resolved = resolveTree(loadAnswers("decline-all.json"));
    // Every resolved relpath must originate from the core/ template group.
    const nonCore = [...resolved.keys()].filter((rel) => !rel.startsWith("core/")).sort();
    expect(nonCore, `declined-component files leaked into a minimal site`).toEqual([]);
    // And no diagram / deploy / drift / symlink / monorepo artifacts by name.
    for (const rel of resolved.keys()) {
      expect(rel).not.toMatch(/setup-docs|prebuild|docs\.yml|vercel|netlify|check-docs|workspace/);
    }
  });
});

describe("template-group coverage (10 §6 item 1)", () => {
  it("every template group (01 §2.2) is exercised by at least one answer set", () => {
    const selected = new Set<string>();
    for (const name of ANSWER_SETS) {
      const sel = loadAnswers(`${name}.json`).selection;
      for (const g of GROUPS) if (g.emit(sel)) selected.add(g.dir);
    }
    const allGroups = GROUPS.map((g) => g.dir);
    const uncovered = allGroups
      .filter((d) => !selected.has(d) && fs.existsSync(path.join(TEMPLATES_DIR, d)))
      .sort();
    expect(uncovered, `template groups never exercised by an answer set`).toEqual([]);
  });
});
