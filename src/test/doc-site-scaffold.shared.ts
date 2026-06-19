/**
 * Shared scaffold-resolution machinery for the scaffold-output golden suite
 * (10 §5) and its deliberate regeneration writer (10 §5.3). Kept in one place so
 * `doc-site-scaffold.test.ts` (which asserts byte-equality) and
 * `regenerate-scaffold-goldens.ts` (which writes the goldens) resolve answer sets
 * through the EXACT same pure procedure — there is no production module; this IS
 * the verification surface (10 §5.2).
 *
 * NO Astro build, diagram render, or network call happens here — the runtime smoke
 * test (REQ-VERIFY-01) is the target-repo obligation owned by
 * 08-rerun-and-verification.md (see 10 §2).
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { REPO_ROOT } from "./golden.shared.js";

export const TEMPLATES_DIR = path.join(REPO_ROOT, "skills/doc-site-plugin/references/templates");
export const SCAFFOLD_GOLDEN_DIR = path.join(REPO_ROOT, "src/test/__scaffold_golden__");
export const ANSWERS_DIR = path.join(REPO_ROOT, "src/test/__fixtures__/doc-site/answers");

/**
 * One interview-answer fixture: the resolved token map (00 §4.1) plus the
 * component-selection record (00 §5). Together these are the complete input to the
 * deterministic substitution procedure — a pure function of these answers
 * (REQ-PORT-02).
 */
export interface ScaffoldAnswers {
  /** Resolved value for every {{TOKEN}} in 00 §4.1 (keys are token names, no braces). */
  readonly tokens: Record<string, string>;
  /** Component-selection record (00 §5) deciding which template groups emit. */
  readonly selection: {
    readonly contentMode: "symlink" | "native" | "mixed";
    readonly diagrams: boolean;
    readonly deploy: ReadonlyArray<"github-pages" | "vercel" | "static-netlify">;
    readonly driftGuard: boolean;
    readonly monorepo: boolean;
  };
}

/** Template groups (01 §2.2) and the predicate deciding whether each is emitted (10 §5.2). */
export const GROUPS: Array<{
  dir: string;
  emit: (s: ScaffoldAnswers["selection"]) => boolean;
}> = [
  { dir: "core", emit: () => true }, // always (01 §2.2)
  { dir: "symlink", emit: (s) => s.contentMode === "symlink" || s.contentMode === "mixed" },
  { dir: "diagrams", emit: (s) => s.diagrams },
  { dir: "deploy/github-pages", emit: (s) => s.deploy.includes("github-pages") },
  { dir: "deploy/vercel", emit: (s) => s.deploy.includes("vercel") },
  { dir: "deploy/static", emit: (s) => s.deploy.includes("static-netlify") },
  { dir: "drift-guard", emit: (s) => s.driftGuard },
  { dir: "monorepo", emit: (s) => s.monorepo },
];

/** Plain global {{TOKEN}} replacement (00 §4: literal, no conditionals/loops). */
export function substitute(body: string, tokens: Record<string, string>): string {
  return body.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_m, name: string) => {
    if (!(name in tokens)) throw new Error(`no answer for {{${name}}}`);
    return tokens[name]!;
  });
}

/** Recursively list every file under `dir`. */
export function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? walk(abs) : [abs];
  });
}

/**
 * Resolve a whole answer set to a map of relpath → resolved bytes. For each SELECTED
 * template group, every `.tmpl` gets substitution + the extension stripped; every
 * other (verbatim) asset rides unchanged. Declined groups contribute nothing
 * (00 §5).
 */
export function resolveTree(answers: ScaffoldAnswers): Map<string, string> {
  const out = new Map<string, string>();
  for (const group of GROUPS) {
    if (!group.emit(answers.selection)) continue; // declined → contributes nothing (00 §5)
    const groupAbs = path.join(TEMPLATES_DIR, group.dir);
    if (!fs.existsSync(groupAbs)) continue;
    for (const abs of walk(groupAbs)) {
      const rel = path.relative(TEMPLATES_DIR, abs).split(path.sep).join("/");
      const raw = fs.readFileSync(abs, "utf8");
      const resolved = abs.endsWith(".tmpl") ? substitute(raw, answers.tokens) : raw;
      out.set(rel.replace(/\.tmpl$/, ""), resolved);
    }
  }
  return out;
}

export function readGoldenTree(name: string): Map<string, string> {
  const base = path.join(SCAFFOLD_GOLDEN_DIR, name);
  const out = new Map<string, string>();
  for (const abs of walk(base)) {
    out.set(path.relative(base, abs).split(path.sep).join("/"), fs.readFileSync(abs, "utf8"));
  }
  return out;
}

export function loadAnswers(file: string): ScaffoldAnswers {
  return JSON.parse(fs.readFileSync(path.join(ANSWERS_DIR, file), "utf8")) as ScaffoldAnswers;
}

/** The committed answer sets exercised by the golden suite (10 §5.1, §6 item 1). */
export const ANSWER_SETS = [
  "single-symlink",
  "monorepo-mixed",
  "decline-all",
  "static-host",
] as const;
