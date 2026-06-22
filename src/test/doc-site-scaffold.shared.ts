/**
 * Shared scaffold-resolution machinery for the doc-site scaffold suites.
 *
 * This module holds the low-level primitives — the answer/site/page types, the
 * canonical token-substitution procedure, the derived-token computation, and a
 * thin `resolveTree` byte-stability guard over the RAW template groups.
 *
 * The high-level "final emitted target tree" resolver — the one that models the
 * post-substitution mechanics an agent performs by hand (package-script merges,
 * sidebar injection, deploy-fragment selection, manifest/provenance generation) —
 * lives in `doc-site-final-scaffold.shared.ts`, layered on top of these
 * primitives. That is the surface the scaffold-output goldens assert against.
 *
 * NO Astro build, diagram render, or network call happens here — the runtime smoke
 * test (REQ-VERIFY-01) is the target-repo obligation owned by
 * 08-rerun-and-verification.md (see 10 §2).
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { REPO_ROOT } from "./golden.shared.js";

export const TEMPLATES_DIR = path.join(REPO_ROOT, "skills/doc-site/references/templates");
export const SCAFFOLD_GOLDEN_DIR = path.join(REPO_ROOT, "src/test/__scaffold_golden__");
export const ANSWERS_DIR = path.join(REPO_ROOT, "src/test/__fixtures__/doc-site/answers");
export const PREEXISTING_DIR = path.join(REPO_ROOT, "src/test/__fixtures__/doc-site/preexisting");

/** A `docs.manifest.json` page entry (00 §2; manifest-schema.md). */
export interface PageEntry {
  readonly slug: string;
  readonly source?: "symlink" | "native";
  readonly from?: string;
  readonly unmanaged?: boolean;
}

/** The `site` block of `docs.manifest.json` (00 §2; manifest-schema.md). */
export interface SiteMeta {
  readonly title: string;
  readonly description: string;
  readonly social?: Record<string, string>;
}

/**
 * One interview-answer fixture: the resolved direct token map (00 §4.1), the
 * component-selection record (00 §5), and the structured manifest inputs
 * (`site` + `pages`) the resolver derives sidebar / symlink lines / manifest from.
 *
 * Derived tokens ({{SYMLINK_PAGE_LINES}}, the toolchain tokens) are NOT stored in
 * `tokens` — they are computed by `deriveTokens()` so a fixture can never
 * hand-author a value inconsistent with `pages`/`selection` (exactly how the
 * symlink-path bug slipped in). Together these are the complete input to the
 * deterministic emit procedure — a pure function of these answers (REQ-PORT-02).
 */
export interface ScaffoldAnswers {
  /** Resolved value for every DIRECT {{TOKEN}} in 00 §4.1 (keys are token names, no braces). */
  readonly tokens: Record<string, string>;
  /** Component-selection record (00 §5) deciding which template groups emit. */
  readonly selection: {
    readonly contentMode: "symlink" | "native" | "mixed";
    readonly diagrams: boolean;
    readonly deploy: ReadonlyArray<"github-pages" | "vercel" | "static-netlify">;
    readonly driftGuard: boolean;
    readonly monorepo: boolean;
  };
  /** `docs.manifest.json` site block. */
  readonly site: SiteMeta;
  /** `docs.manifest.json` pages (sidebar order). The seeded `guides/setup` native page is added by the resolver when absent. */
  readonly pages: ReadonlyArray<PageEntry>;
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
 * The `guides/setup` starter page is ALWAYS seeded into the manifest (core.md §1):
 * `index.mdx` hard-links to `guides/setup/`, so the native page must exist in every
 * content mode or the `broken-link` drift rule fires. Returns the effective pages
 * array with the seed appended iff no page already owns that slug.
 */
export function effectivePages(pages: ReadonlyArray<PageEntry>): PageEntry[] {
  const out = pages.map((p) => ({ ...p }));
  if (!out.some((p) => p.slug === "guides/setup")) {
    out.push({ slug: "guides/setup", source: "native" });
  }
  return out;
}

/** {{CI_SETUP_ACTION}} — runtime-axis CI setup action (SKILL.md derived-token table). */
function ciSetupAction(runtime: string): string {
  return runtime === "bun" ? "oven-sh/setup-bun@v2" : "actions/setup-node@v4";
}

/** {{INSTALL_CMD}} — package-manager frozen-lockfile install (SKILL.md derived-token table). */
function installCmd(pkgManager: string): string {
  switch (pkgManager) {
    case "pnpm":
      return "pnpm install --frozen-lockfile";
    case "yarn":
      return "yarn install --immutable";
    case "bun":
      return "bun install";
    default:
      return "npm ci";
  }
}

/** {{RUN_PREFIX}} — run-a-script prefix (SKILL.md derived-token table). */
function runPrefix(pkgManager: string): string {
  switch (pkgManager) {
    case "pnpm":
      return "pnpm run";
    case "yarn":
      return "yarn run";
    case "bun":
      return "bun run";
    default:
      return "npm run";
  }
}

/** {{WORKSPACE_BUILD}} — workspace/filter build invocation (SKILL.md derived-token table). */
function workspaceBuild(pkgManager: string, docsPkgDir: string): string {
  switch (pkgManager) {
    case "pnpm":
      return `pnpm --filter ./${docsPkgDir} build`;
    case "yarn":
      return `yarn workspace ${docsPkgDir} build`;
    case "bun":
      return `bun run --filter ./${docsPkgDir} build`;
    default:
      return `npm run build --workspace ${docsPkgDir}`;
  }
}

/** One `link_file` line per `source: "symlink"` && !unmanaged page, in manifest order (symlink.md §2). */
export function symlinkPageLines(pages: ReadonlyArray<PageEntry>): string {
  return effectivePages(pages)
    .filter((p) => p.source === "symlink" && p.unmanaged !== true)
    .map((p) => `link_file "${p.from}" "${p.slug}"`)
    .join("\n");
}

/**
 * The complete token map for substitution: the fixture's DIRECT tokens plus every
 * derived token (00 §4.1 derived rows). A fixture never carries these — deriving
 * them here guarantees they stay consistent with `pages`/`selection`.
 */
export function deriveTokens(answers: ScaffoldAnswers): Record<string, string> {
  const t = answers.tokens;
  return {
    ...t,
    SYMLINK_PAGE_LINES: symlinkPageLines(answers.pages),
    CI_SETUP_ACTION: ciSetupAction(t.RUNTIME ?? "node"),
    INSTALL_CMD: installCmd(t.PKG_MANAGER ?? "npm"),
    RUN_PREFIX: runPrefix(t.PKG_MANAGER ?? "npm"),
    WORKSPACE_BUILD: workspaceBuild(t.PKG_MANAGER ?? "npm", t.DOCS_PKG_DIR ?? "docs"),
  };
}

/**
 * Resolve a whole answer set to a map of group-relpath → resolved bytes. For each
 * SELECTED template group, every `.tmpl` gets substitution + the extension
 * stripped; every other (verbatim) asset rides unchanged. This is the RAW-template
 * byte-stability guard (a thin fast unit) — it proves substitution is deterministic
 * but does NOT model the final emitted target tree (that is `finalScaffold`).
 */
export function resolveTree(answers: ScaffoldAnswers): Map<string, string> {
  const tokens = deriveTokens(answers);
  const out = new Map<string, string>();
  for (const group of GROUPS) {
    if (!group.emit(answers.selection)) continue; // declined → contributes nothing (00 §5)
    const groupAbs = path.join(TEMPLATES_DIR, group.dir);
    if (!fs.existsSync(groupAbs)) continue;
    for (const abs of walk(groupAbs)) {
      const rel = path.relative(TEMPLATES_DIR, abs).split(path.sep).join("/");
      const raw = fs.readFileSync(abs, "utf8");
      const resolved = abs.endsWith(".tmpl") ? substitute(raw, tokens) : raw;
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
